/* Five-band Web Audio equalizer and real playback spectrum.
 * Never feed a non-CORS stream into a MediaElementSource: browsers would mute it.
 * The player probes stream access first and falls back to native playback if needed.
 */
'use strict';

window.AudioEffects = (() => {
    const frequencies = [60, 250, 1000, 4000, 12000];
    const labels = ['60 Hz', '250 Hz', '1 kHz', '4 kHz', '12 kHz'];
    const descriptions = ['Bass', 'Warmth', 'Presence', 'Clarity', 'Air'];
    const presets = {
        flat: { name: 'Flat', gains: [0, 0, 0, 0, 0] },
        bass: { name: 'Bass Boost', gains: [6, 4, 0, -1, 0] },
        vocal: { name: 'Vocal', gains: [-2, -1, 4, 2, -1] },
        pop: { name: 'Pop', gains: [-1, 2, 3, 2, 1] },
        rock: { name: 'Rock', gains: [4, 2, -1, 2, 4] }
    };
    let settings = { enabled: true, preset: 'flat', gains: [0, 0, 0, 0, 0] };
    try {
        const saved = JSON.parse(localStorage.getItem('ev_equalizer'));
        if (saved && Array.isArray(saved.gains) && saved.gains.length === 5) {
            settings = {
                enabled: saved.enabled !== false,
                preset: presets[saved.preset] ? saved.preset : 'custom',
                gains: saved.gains.map(value => clamp(value))
            };
        }
    } catch (_) { /* Keep the default if browser storage is unavailable. */ }

    let context = null;
    let preamp = null;
    let filters = [];
    let analyser = null;
    let frequencyData = null;
    let source = null;
    let sourcePlayer = null;
    let activePlayer = null;
    let sourceUsable = null;
    let unavailableReason = '';
    let playing = false;
    let animationId = null;
    let returnFocus = null;
    const sources = new WeakMap();
    const corsCache = new Map();

    function clamp(value) {
        const number = Number(value);
        return Number.isFinite(number) ? Math.max(-12, Math.min(12, Math.round(number))) : 0;
    }
    function supported() { return Boolean(window.AudioContext || window.webkitAudioContext); }
    function save() {
        try { localStorage.setItem('ev_equalizer', JSON.stringify(settings)); } catch (_) {}
    }
    function ensureContext() {
        if (context || !supported()) return context;
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            context = new AudioContextClass();
            preamp = context.createGain();
            filters = frequencies.map((frequency, index) => {
                const filter = context.createBiquadFilter();
                filter.type = index === 0 ? 'lowshelf' : index === 4 ? 'highshelf' : 'peaking';
                filter.frequency.value = frequency;
                filter.Q.value = 0.9;
                return filter;
            });
            const limiter = context.createDynamicsCompressor();
            limiter.threshold.value = -1;
            limiter.knee.value = 0;
            limiter.ratio.value = 12;
            limiter.attack.value = 0.003;
            limiter.release.value = 0.12;
            analyser = context.createAnalyser();
            analyser.fftSize = 2048;
            analyser.minDecibels = -85;
            analyser.maxDecibels = -15;
            analyser.smoothingTimeConstant = 0.74;
            frequencyData = new Uint8Array(analyser.frequencyBinCount);
            let previous = preamp;
            filters.forEach(filter => { previous.connect(filter); previous = filter; });
            previous.connect(limiter);
            limiter.connect(analyser);
            analyser.connect(context.destination);
            applyGains();
        } catch (error) {
            console.warn('Audio processing unavailable:', error);
            unavailableReason = 'Audio processing is not available in this browser. Standard playback still works.';
            sourceUsable = false;
            return null;
        }
        return context;
    }
    function unlock() {
        const ctx = ensureContext();
        if (ctx && ctx.state === 'suspended') ctx.resume().then(startSpectrum).catch(() => render());
    }
    async function checkStream(url) {
        if (!supported()) return false;
        try {
            const parsed = new URL(url, window.location.href);
            if (parsed.origin === window.location.origin || ['data:', 'blob:'].includes(parsed.protocol)) return true;
        } catch (_) { return false; }
        if (corsCache.has(url)) return corsCache.get(url);
        let allowed = false;
        try {
            const response = await fetch(url, {
                mode: 'cors', headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(4000)
            });
            allowed = response.ok;
            if (response.body) response.body.cancel().catch(() => {});
        } catch (_) { /* An unreadable stream must use native, unprocessed playback. */ }
        corsCache.set(url, allowed);
        if (corsCache.size > 150) corsCache.delete(corsCache.keys().next().value);
        return allowed;
    }
    function connect(player) {
        const ctx = ensureContext();
        if (!ctx) return false;
        try {
            if (source && sourcePlayer !== player) source.disconnect();
            const node = sources.get(player) || ctx.createMediaElementSource(player);
            if (!sources.has(player)) sources.set(player, node);
            if (source !== node) node.connect(preamp);
            source = node;
            sourcePlayer = player;
            activePlayer = player;
            sourceUsable = true;
            unavailableReason = '';
            applyGains();
            unlock();
            render();
            return true;
        } catch (error) {
            console.warn('Equalizer connection failed:', error);
            unavailable('Equalizer unavailable for this stream. Original audio playback is active.');
            return false;
        }
    }
    function disconnect() {
        if (source) { try { source.disconnect(); } catch (_) {} }
        source = null;
        sourcePlayer = null;
        stopSpectrum();
    }
    function unavailable(reason) {
        disconnect();
        sourceUsable = false;
        unavailableReason = reason || 'This stream does not permit audio processing. Original playback is active.';
        render();
    }
    function applyGains() {
        if (!context || !preamp) return;
        const gains = settings.enabled ? settings.gains : [0, 0, 0, 0, 0];
        filters.forEach((filter, index) => filter.gain.setTargetAtTime(gains[index], context.currentTime, 0.025));
        const boost = Math.max(0, ...gains);
        // Leave headroom for boosted bands; a gentle peak limiter catches overshoot.
        preamp.gain.setTargetAtTime(Math.pow(10, -boost * 0.5 / 20), context.currentTime, 0.025);
    }
    function setBand(index, value) {
        if (index < 0 || index >= frequencies.length) return;
        settings.gains[index] = clamp(value);
        const match = Object.entries(presets).find(([, preset]) => preset.gains.every((gain, i) => gain === settings.gains[i]));
        settings.preset = match ? match[0] : 'custom';
        applyGains(); save(); render();
    }
    function preset(key) {
        if (!presets[key]) return;
        settings.preset = key;
        settings.gains = presets[key].gains.slice();
        applyGains(); save(); render();
    }
    function toggle() {
        settings.enabled = !settings.enabled;
        applyGains(); save(); render();
    }
    function buildUi() {
        const bandContainer = document.getElementById('eqBands');
        const presetContainer = document.getElementById('eqPresets');
        if (!bandContainer || bandContainer.childElementCount) return;
        Object.entries(presets).forEach(([key, preset]) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'eq-preset';
            button.dataset.preset = key;
            button.textContent = preset.name;
            button.onclick = () => AudioEffects.preset(key);
            presetContainer.appendChild(button);
        });
        frequencies.forEach((frequency, index) => {
            const band = document.createElement('div');
            band.className = 'eq-band';
            band.innerHTML = `<output id="eqGain${index}" for="eqBand${index}">0 dB</output>
                <div class="eq-slider-track"><input type="range" id="eqBand${index}" min="-12" max="12" step="1" value="0" aria-label="${labels[index]} ${descriptions[index]} gain"></div>
                <label for="eqBand${index}">${labels[index]}</label><span>${descriptions[index]}</span>`;
            const input = band.querySelector('input');
            input.oninput = () => setBand(index, input.value);
            input.onkeydown = event => {
                if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                    event.preventDefault();
                    setBand(index, Number(input.value) + (event.key === 'ArrowUp' ? 1 : -1));
                }
            };
            bandContainer.appendChild(band);
        });
    }
    function render() {
        buildUi();
        const blocked = !supported() || sourceUsable === false;
        const title = presets[settings.preset] ? presets[settings.preset].name : 'Custom';
        const name = document.getElementById('eqPresetName');
        if (name) name.textContent = title;
        document.querySelectorAll('.eq-preset').forEach(button => {
            const selected = button.dataset.preset === settings.preset;
            button.classList.toggle('active', selected);
            button.setAttribute('aria-pressed', String(selected));
            button.disabled = blocked;
        });
        settings.gains.forEach((gain, index) => {
            const input = document.getElementById('eqBand' + index);
            const output = document.getElementById('eqGain' + index);
            if (!input || !output) return;
            input.value = gain;
            input.disabled = blocked || !settings.enabled;
            input.setAttribute('aria-valuetext', `${gain > 0 ? '+' : ''}${gain} decibels`);
            output.textContent = `${gain > 0 ? '+' : ''}${gain} dB`;
        });
        const toggleButton = document.getElementById('eqEnableBtn');
        if (toggleButton) {
            toggleButton.setAttribute('aria-checked', String(settings.enabled));
            toggleButton.disabled = blocked;
        }
        const enableLabel = document.getElementById('eqEnableLabel');
        if (enableLabel) enableLabel.textContent = settings.enabled ? 'On' : 'Off';
        const button = document.getElementById('equalizerBtn');
        if (button) {
            button.classList.toggle('active', settings.enabled && settings.gains.some(gain => gain !== 0));
            button.title = 'Equalizer: ' + (settings.enabled ? title : 'Off');
        }
        const status = document.getElementById('eqStatus');
        if (status) {
            status.classList.toggle('is-warning', blocked);
            status.textContent = blocked ? (unavailableReason || 'Web Audio is not supported here. Standard playback still works.') :
                !activePlayer || !activePlayer.src ? 'Start a song to hear your settings.' :
                !playing ? 'Paused — your settings will apply when playback resumes.' :
                settings.enabled ? 'Live audio processing · ' + title + ' · settings saved on this browser.' :
                'Equalizer bypassed — original tone. Your band settings are kept.';
        }
        const spectrumState = document.getElementById('eqSpectrumState');
        if (spectrumState) spectrumState.textContent = blocked ? 'Unavailable' : playing && sourceUsable ? 'Live' : 'Paused';
        // The sidebar status card mirrors the same state without duplicating logic.
        if (typeof window.onEqualizerState === 'function') {
            window.onEqualizerState({ blocked, enabled: settings.enabled, title, playing, gains: settings.gains.slice() });
        }
    }
    function resetBars() {
        document.querySelectorAll('.playback-spectrum span, .equalizer-spectrum span, .eq-overlay span, .eq-mini span, .vibe-eq span').forEach(bar => {
            bar.style.transform = 'scaleY(0.06)';
        });
    }
    function stopSpectrum() {
        if (animationId !== null) cancelAnimationFrame(animationId);
        animationId = null;
        if (frequencyData) frequencyData.fill(0);
        resetBars();
    }
    function startSpectrum() {
        if (animationId !== null || !playing || !source || !analyser || context.state !== 'running' || document.hidden) return;
        animationId = requestAnimationFrame(drawSpectrum);
    }
    function drawSpectrum() {
        animationId = null;
        if (!playing || !source || !activePlayer || activePlayer.paused || document.hidden) { stopSpectrum(); return; }
        analyser.getByteFrequencyData(frequencyData);
        const nyquist = context.sampleRate / 2;
        ['.playback-spectrum', '.equalizer-spectrum', '.eq-overlay', '.eq-mini', '.vibe-eq'].forEach(selector => {
            const bars = document.querySelectorAll(selector + ' span');
            bars.forEach((bar, index) => {
                const minFrequency = 40 * Math.pow(400, index / bars.length);
                const maxFrequency = 40 * Math.pow(400, (index + 1) / bars.length);
                const first = Math.min(frequencyData.length - 1, Math.floor(minFrequency / nyquist * frequencyData.length));
                const last = Math.min(frequencyData.length - 1, Math.max(first, Math.floor(maxFrequency / nyquist * frequencyData.length)));
                let peak = 0;
                for (let bin = first; bin <= last; bin++) peak = Math.max(peak, frequencyData[bin]);
                const level = activePlayer.volume === 0 ? 0 : peak / 255;
                bar.style.transform = `scaleY(${Math.max(0.06, level).toFixed(3)})`;
            });
        });
        animationId = requestAnimationFrame(drawSpectrum);
    }
    function playbackChanged(player, state) {
        activePlayer = player;
        playing = state;
        if (state) { unlock(); startSpectrum(); } else stopSpectrum();
        render();
    }
    function open() {
        returnFocus = document.activeElement;
        unlock(); render();
        const modal = document.getElementById('equalizerModalOverlay');
        if (!modal) return;
        modal.classList.add('active');
        const button = document.getElementById('equalizerBtn');
        if (button) button.setAttribute('aria-expanded', 'true');
        modal.querySelector('.modal-close-btn').focus();
    }
    function close(event) {
        if (event && event.target !== event.currentTarget) return;
        const modal = document.getElementById('equalizerModalOverlay');
        if (modal) modal.classList.remove('active');
        const button = document.getElementById('equalizerBtn');
        if (button) button.setAttribute('aria-expanded', 'false');
        if (returnFocus && document.contains(returnFocus) && returnFocus.offsetParent !== null) returnFocus.focus();
    }
    function init() {
        render(); resetBars();
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) stopSpectrum(); else startSpectrum();
        });
    }
    return {
        init, open, close, preset, toggle, setBand, unlock, supported, checkStream, connect, disconnect,
        unavailable, playbackChanged,
        isConnectedTo: player => sourcePlayer === player && Boolean(source),
        get settings() { return { ...settings, gains: settings.gains.slice() }; },
        get context() { return context; },
        get filters() { return filters.slice(); },
        get analyser() { return analyser; }
    };
})();
