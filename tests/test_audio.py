"""Deterministic discovery and real Web Audio regression checks.

Serve the app on port 8000, then run: python3 tests/test_audio.py
Uses a generated 1 kHz WAV tone, silence and mocked API responses. Verifies
actual analyser output attenuation, not just slider values or animations.
"""
import base64
import io
import json
import math
import os
from pathlib import Path
import struct
from urllib.parse import urlparse, parse_qs
import wave

from playwright.sync_api import sync_playwright, expect

URL = os.environ.get('APP_URL', 'http://127.0.0.1:8000')
QA = Path('.cache/dashboard-update')
QA.mkdir(parents=True, exist_ok=True)
ART = 'data:image/svg+xml;base64,' + base64.b64encode(
    b'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#6d28d9"/></svg>'
).decode()


def wav_bytes(silent=False):
    sample_rate = 32000
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        values = (0 if silent else int(0.08 * 32767 * math.sin(2 * math.pi * 1000 * i / sample_rate)) for i in range(sample_rate * 20))
        wav.writeframes(b''.join(struct.pack('<h', value) for value in values))
    return buffer.getvalue()


def song(name, index=0, url=None):
    return {'id': f'{name}-{index}', 'name': f'{name} Track {index}', 'duration': 20,
            'artists': {'primary': [{'name': 'Fixture Artist'}]},
            'image': [{'quality': '500x500', 'url': ART}],
            'downloadUrl': [{'quality': '320kbps', 'url': url or URL + '/tone.wav'}]}


def api(route):
    parsed = urlparse(route.request.url)
    query = parse_qs(parsed.query).get('query', ['Trending'])[0]
    if parsed.path in ('/api/trending/songs', '/api/search/songs'):
        data = {'results': [song(query, index) for index in range(12)]}
    elif parsed.path == '/api/songs':
        data = [song('Fetched')]
    elif parsed.path == '/api/search':
        data = {'songs': {'results': [song(query, 1)]}, 'albums': {'results': []}}
    else:
        data = {'results': []}
    route.fulfill(status=200, content_type='application/json', body=json.dumps({'success': True, 'data': data}))


def stable_rms(page, attempts=45):
    """Wait out Chrome's limiter/compressor ramp so ratios compare steady states."""
    previous = rms(page)
    for _ in range(attempts):
        page.wait_for_timeout(120)
        current = rms(page)
        if previous > 0 and abs(current - previous) / previous < 0.02:
            return current
        previous = current
    raise AssertionError('analyser level did not stabilise')


def rms(page):
    return page.evaluate('''() => {
        const samples = new Float32Array(AudioEffects.analyser.fftSize);
        AudioEffects.analyser.getFloatTimeDomainData(samples);
        return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    }''')


with sync_playwright() as p:
    browser = p.chromium.launch(args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    context.route('https://elitejiosaavn-api.vercel.app/**', api)
    tone = wav_bytes()
    silence = wav_bytes(silent=True)
    context.route('**/tone.wav', lambda route: route.fulfill(status=200, content_type='audio/wav', body=tone))
    context.route('**/silence.wav', lambda route: route.fulfill(status=200, content_type='audio/wav', body=silence))
    # Simulate a denied CORS probe while still serving the native media request.
    # Playwright's fulfilment can bypass CORS, so explicitly deny only fetch/XHR.
    def blocked_stream(route):
        if route.request.resource_type in ('fetch', 'xhr'):
            route.abort('accessdenied')
        else:
            route.fulfill(status=200, content_type='audio/wav', body=tone)
    context.route('https://blocked-stream.example/**', blocked_stream)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(URL, wait_until='domcontentloaded')
    page.evaluate('Math.random = () => 0')
    played_ids = []
    for _ in range(5):
        page.locator('#heroDiscoveryBtn').click()
        page.wait_for_function('!discoveryBusy && !isLoadingSong && isPlaying && !audio.paused')
        played_ids.append(page.evaluate('currentSong.id'))
        expect(page.locator('#heroPlayText')).to_have_text('Play Now')
    assert len(set(played_ids)) == 5, played_ids
    assert page.evaluate('currentQueue.length') > 1
    playing_id = page.evaluate('currentSong.id')
    page.locator('#bottomPlayBtn').click()
    page.wait_for_function('!isPlaying && audio.paused')
    assert page.evaluate('currentSong.id') == playing_id
    page.locator('#bottomPlayBtn').click()
    page.wait_for_function('isPlaying && !audio.paused')
    assert page.evaluate('currentSong.id') == playing_id
    print('PASS: five unique Play Now selections even with deterministic randomness; pause/resume preserves the selected track')

    page.wait_for_function('AudioEffects.context && AudioEffects.context.state === "running" && AudioEffects.filters.length === 5')
    page.wait_for_function('''() => {
        const values = new Uint8Array(AudioEffects.analyser.frequencyBinCount);
        AudioEffects.analyser.getByteFrequencyData(values);
        return Math.max(...values) > 80;
    }''')
    baseline = stable_rms(page)
    assert baseline > 0.005, baseline
    page.locator('#equalizerBtn').click()
    expect(page.locator('#equalizerModalOverlay')).to_have_class('modal-overlay active')
    expect(page.locator('#eqBands input')).to_have_count(5)
    expect(page.locator('#eqSpectrumState')).to_have_text('Live')
    page.locator('#eqBand2').evaluate('(e) => { e.value = "-12"; e.dispatchEvent(new Event("input", {bubbles:true})); }')
    expect(page.locator('#eqGain2')).to_have_text('-12 dB')
    expect(page.locator('#eqPresetName')).to_have_text('Custom')
    page.wait_for_function('Math.abs(AudioEffects.filters[2].gain.value + 12) < 0.05')
    page.wait_for_timeout(220)
    attenuated = stable_rms(page)
    ratio = attenuated / baseline
    assert 0.15 < ratio < 0.4, (baseline, attenuated, ratio)
    page.locator('#eqBand2').focus()
    page.locator('#eqBand2').press('ArrowUp')
    expect(page.locator('#eqGain2')).to_have_text('-11 dB')
    page.locator('#eqEnableBtn').click()
    expect(page.locator('#eqEnableBtn')).to_have_attribute('aria-checked', 'false')
    expect(page.locator('#eqBand2')).to_be_disabled()
    page.wait_for_function('Math.abs(AudioEffects.filters[2].gain.value) < 0.05')
    page.wait_for_timeout(150)
    bypass_rms = stable_rms(page)
    assert 0.85 < bypass_rms / baseline < 1.15, (bypass_rms, baseline)
    page.locator('#eqEnableBtn').click()
    page.locator('.eq-preset[data-preset="bass"]').click()
    expect(page.locator('#eqPresetName')).to_have_text('Bass Boost')
    assert page.evaluate('AudioEffects.settings.gains') == [6, 4, 0, -1, 0]
    page.wait_for_function('Math.abs(AudioEffects.filters[0].gain.value - 6) < 0.05')
    page.screenshot(path=str(QA / 'equalizer-working.png'), animations='disabled')
    stored_equalizer = page.evaluate('localStorage.getItem("ev_equalizer")')
    print(f'PASS: actual 1 kHz output attenuated to {ratio:.3f} of Flat (expected about 0.251); bypass restores original level, presets and keyboard controls work')

    # Real bars follow the analyser, and stop instead of looping fake CSS animations.
    page.wait_for_function('''() => [...document.querySelectorAll('#equalizerSpectrum span')]
        .some(bar => Number(bar.style.transform.match(/[0-9.]+/)[0]) > 0.2)''')
    assert page.locator('.vibe-eq span').first.evaluate('(e) => getComputedStyle(e).animationName') == 'none'
    page.keyboard.press('Escape')
    expect(page.locator('#equalizerModalOverlay')).not_to_have_class('modal-overlay active')
    page.locator('#bottomPlayBtn').click()
    page.wait_for_function('audio.paused && !isPlaying')
    assert page.locator('#playbackSpectrum span').evaluate_all('(bars) => bars.every(bar => bar.style.transform === "scaleY(0.06)")')
    page.locator('#bottomPlayBtn').click()
    page.wait_for_function('isPlaying && !audio.paused')
    silent_song = song('Silence', url=URL + '/silence.wav')
    page.evaluate('(song) => startPlay(song, [song], 0)', silent_song)
    page.wait_for_function('''() => [...document.querySelectorAll('#playbackSpectrum span')]
        .every(bar => Number(bar.style.transform.match(/[0-9.]+/)[0]) <= 0.07)''')
    print('PASS: analyser-driven spectrum responds to audio, rests on pause, and stays quiet for actual silence')

    blocked_song = song('Native fallback', url='https://blocked-stream.example/tone.wav')
    page.evaluate('(song) => startPlay(song, [song], 0)', blocked_song)
    page.wait_for_function('isPlaying && !audio.paused && audio.crossOrigin === null')
    assert not page.evaluate('AudioEffects.isConnectedTo(audio)')
    page.locator('#equalizerBtn').click()
    expect(page.locator('#eqStatus')).to_contain_text('Original playback is active')
    expect(page.locator('#eqBand0')).to_be_disabled()
    expect(page.locator('#eqSpectrumState')).to_have_text('Unavailable')
    page.keyboard.press('Escape')
    good_song = song('Processing restored')
    page.evaluate('(song) => startPlay(song, [song], 0)', good_song)
    page.wait_for_function('isPlaying && AudioEffects.isConnectedTo(audio) && audio.crossOrigin === "anonymous"')
    assert page.evaluate('AudioEffects.settings.gains') == [6, 4, 0, -1, 0]
    print('PASS: CORS-restricted stream falls back to working native playback, then EQ reconnects on a supported track')

    # A late old song-details response must not replace the newer selected song.
    page.evaluate('''() => {
        window.originalCallApi = callApi;
        callApi = (endpoint, params) => endpoint === '/api/songs' && params.id === 'slow-old'
            ? new Promise(resolve => window.resolveSlow = resolve) : originalCallApi(endpoint, params);
        window.pendingOldPlay = startPlay({id:'slow-old', name:'Old slow track', image:[]}, [], 0);
    }''')
    page.wait_for_function('typeof resolveSlow === "function"')
    newer = song('Newer selection')
    page.evaluate('(song) => startPlay(song, [song], 0)', newer)
    page.evaluate('(old) => resolveSlow([old])', song('Old late response'))
    page.evaluate('pendingOldPlay')
    assert page.evaluate('currentSong.id') == newer['id']
    assert page.evaluate('isPlaying')
    page.evaluate('callApi = originalCallApi')
    print('PASS: late playback requests cannot overwrite a newer song selection')

    # A discovery request finishing after a manual selection must not take over.
    page.evaluate('''() => {
        window.originalDiscoveryApi = callApi;
        window.discoveryResolvers = [];
        callApi = (endpoint, params) => ['/api/trending/songs', '/api/search/songs'].includes(endpoint)
            ? new Promise(resolve => discoveryResolvers.push(resolve)) : originalDiscoveryApi(endpoint, params);
        discoveryPool = [];
        discoveryUpdatedAt = 0;
        window.pendingDiscovery = playRandomSong();
    }''')
    page.wait_for_function('discoveryResolvers.length === 3')
    manual = song('Manual selection wins')
    page.evaluate('(song) => startPlay(song, [song], 0)', manual)
    page.evaluate('(late) => discoveryResolvers.forEach(resolve => resolve({results:[late]}))', song('Late discovery'))
    page.evaluate('pendingDiscovery')
    assert page.evaluate('currentSong.id') == manual['id']
    assert not page.evaluate('discoveryBusy')
    assert page.evaluate('isPlaying')
    page.evaluate('callApi = originalDiscoveryApi')
    print('PASS: selecting a song manually cancels a pending Play Now discovery result')

    page.reload(wait_until='domcontentloaded')
    assert page.evaluate('localStorage.getItem("ev_equalizer")') == stored_equalizer
    assert page.evaluate('AudioEffects.settings.gains') == [6, 4, 0, -1, 0]
    page.locator('#heroDiscoveryBtn').click()
    page.wait_for_function('isPlaying && !discoveryBusy && AudioEffects.context.state === "running"')
    page.wait_for_function('Math.abs(AudioEffects.filters[0].gain.value - 6) < 0.05')
    page.set_viewport_size({'width':390, 'height':844})
    page.locator('#equalizerBtn').click()
    expect(page.locator('#equalizerModalOverlay')).to_have_class('modal-overlay active')
    assert page.locator('.equalizer-modal').evaluate('(el) => el.scrollWidth <= el.clientWidth')
    page.screenshot(path=str(QA / 'equalizer-mobile.png'), animations='disabled')
    print('PASS: saved EQ settings survive refresh and apply to the next stream; mobile modal fits')
    assert not errors, '\n'.join(errors)
    print('PASS: no browser JavaScript errors')
    browser.close()
