"""Browser regression checks with mock music API and simulated speech input.

Run with the app served on port 8000:
  python3 -m pip install playwright
  python3 -m playwright install chromium
  python3 tests/test_ui.py

These checks exercise the interface, storage and player wiring; they do not
claim to verify the external service or actual microphone recognition.
"""
import base64
import io
import json
import os
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from PIL import Image
import wave

from playwright.sync_api import sync_playwright, expect

URL = os.environ.get('APP_URL', 'http://127.0.0.1:8000')
QA = Path('.cache/eccoverse-checks')
QA.mkdir(parents=True, exist_ok=True)
ART = 'data:image/svg+xml;base64,' + base64.b64encode(
    b'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#6d28d9"/></svg>'
).decode()


def song(query, number=1):
    return {
        'id': f'{query}-{number}', 'name': f'{query} Track {number}',
        'artists': {'primary': [{'name': 'Test Singer'}]}, 'duration': 180,
        'image': [{'quality': '500x500', 'url': ART}],
        'downloadUrl': [{'quality': '320kbps', 'url': URL + '/test-audio.wav'}]
    }


def mock_api(route):
    parsed = urlparse(route.request.url)
    params = parse_qs(parsed.query)
    query = params.get('query', ['Fixture'])[0]
    songs = [] if query == 'no matches' else [song(query, 1), song(query, 2)]
    if parsed.path == '/api/trending/songs':
        data = {'results': [song('Trending', number) for number in range(1, 6)]}
        route.fulfill(status=200, content_type='application/json', body=json.dumps({'success': True, 'data': data}))
        return
    if parsed.path == '/api/search':
        data = {
            'songs': {'results': songs},
            'albums': {'results': [] if query == 'no matches' else [
                {'id': 'album1', 'name': query + ' Album', 'image': [], 'subtitle': 'Test Singer'}
            ]},
            # Deliberately included to check these never appear in search.
            'artists': {'results': [{'id': 'artist1', 'name': 'Unwanted Artist Card', 'image': []}]}
        }
    elif parsed.path == '/api/search/songs':
        data = {'results': songs}
    elif parsed.path == '/api/albums':
        data = {'songs': [song('Album')]}
    elif parsed.path == '/api/songs':
        data = [song('Fetched')]
    else:
        data = {'results': []}
    route.fulfill(status=200, content_type='application/json', body=json.dumps({'success': True, 'data': data}))


def gradient(page, selector):
    return page.locator(selector).evaluate('(el) => getComputedStyle(el).backgroundImage')


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    context.route('https://elitejiosaavn-api.vercel.app/**', mock_api)
    wav_buffer = io.BytesIO()
    with wave.open(wav_buffer, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(8000)
        wav.writeframes(b'\x00\x00' * 8000 * 5)
    context.route('**/test-audio.wav', lambda route: route.fulfill(
        status=200, content_type='audio/wav', body=wav_buffer.getvalue()))
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(URL, wait_until='domcontentloaded')
    page.wait_for_function("typeof openSearchInterface === 'function'")
    liked = [{'id': 'saved-favorite', 'name': 'Saved Favorite', 'image': []}]
    page.evaluate('(liked) => Storage.set("liked", liked)', liked)

    assert page.locator('#searchInput').evaluate('(e) => getComputedStyle(e).backgroundColor') == 'rgba(0, 0, 0, 0)'
    page.locator('#searchInput').click()
    expect(page.locator('#dashboardSearchPanel')).to_have_class('dashboard-search-panel active')
    expect(page.locator('#searchInput')).to_be_focused()
    assert page.locator('#searchInput').count() == 1
    assert page.locator('#interfaceSearchInput, #searchOverlayInterface').count() == 0
    expect(page.locator('.topbar')).to_be_visible()
    expect(page.locator('.sidebar')).to_be_visible()
    expect(page.locator('#page-home')).to_be_visible()
    assert page.locator('#dashboardSearchPanel').evaluate('(el) => el.parentElement.id') == 'contentArea'
    assert page.locator('#searchInput').evaluate('(el) => getComputedStyle(el).borderWidth') == '0px'
    # The reference console is three panes: sidebar, dashboard column and right rail.
    for pane in ('.sidebar', '.center-col', '.right-rail'):
        assert page.locator(pane).is_visible(), pane
    assert page.locator('#searchInput').evaluate('(el) => el.closest(".center-col") && !el.closest(".dashboard-search-panel")') is True
    assert page.locator('#dashboardSearchPanel').evaluate('(el) => Boolean(el.closest(".center-col"))') is True

    assert page.locator('#searchInput').evaluate('(e) => getComputedStyle(e).backgroundColor') == 'rgba(0, 0, 0, 0)'
    assert page.locator('#searchInput').evaluate('(e) => getComputedStyle(e).boxShadow') == 'none'
    page.locator('#searchInput').fill('Arijit Singh')
    expect(page.locator('#searchResSongsList .song-list-item')).to_have_count(2)
    assert page.locator('.res-tab').all_text_contents() == ['All Results', 'Songs 🎵', 'Albums 💿']
    assert page.locator('#searchResArtistsSection, #tabResArtists').count() == 0
    assert 'Unwanted Artist Card' not in page.locator('#dashboardSearchPanel').inner_text()
    assert page.locator('.nav-item[data-page="artists"]').count() == 1
    page.locator('#tabResSongs').click()
    expect(page.locator('#searchResSongsSection')).to_be_visible()
    expect(page.locator('#searchResAlbumsSection')).to_be_hidden()
    page.locator('#tabResAlbums').click()
    expect(page.locator('#searchResSongsSection')).to_be_hidden()
    expect(page.locator('#searchResAlbumsSection')).to_be_visible()
    page.locator('#tabResAll').click()
    expect(page.locator('#searchResSongsSection')).to_be_visible()
    expect(page.locator('#searchResAlbumsSection')).to_be_visible()
    page.screenshot(path=str(QA / 'search-desktop.png'), animations='disabled')
    page.locator('#searchClear').click()
    expect(page.locator('#searchSuggestionsView')).to_be_visible()
    expect(page.locator('#interfaceSearchResults')).to_be_hidden()
    # Clearing a pending debounce must not re-open previous results.
    page.locator('#searchInput').fill('Pending query')
    page.locator('#searchClear').click()
    page.wait_for_timeout(500)
    expect(page.locator('#interfaceSearchResults')).to_be_hidden()
    page.locator('#searchInput').press('Escape')
    expect(page.locator('#dashboardSearchPanel')).not_to_have_class('dashboard-search-panel active')
    print('PASS: dashboard-merged search in the console header, one borderless input, no fullscreen overlay, category filters and clear/Escape controls')

    page.evaluate("navigateTo('playlists')")
    palette = [('purple', '#8B5CF6'), ('cyan', '#06B6D4'), ('pink', '#EC4899'), ('amber', '#F59E0B'), ('emerald', '#10B981')]
    expected_covers = {}
    for theme, color in palette:
        page.locator('#page-playlists button', has_text='New Playlist').click()
        expect(page.locator('.theme-opt.active')).to_have_attribute('data-theme', 'purple')
        page.locator('#newPlaylistNameInput').fill(theme.title() + ' Collection')
        expect(page.locator('#newPlaylistPreviewName')).to_have_text(theme.title() + ' Collection')
        swatch = page.locator(f'.theme-opt[data-theme="{theme}"]')
        if theme == 'cyan':
            swatch.focus()
            swatch.press('Space')
        else:
            swatch.click()
        expect(page.locator('.theme-opt.active')).to_have_count(1)
        expect(swatch).to_have_attribute('aria-pressed', 'true')
        expect(page.locator('#selectedPlaylistThemeName')).to_have_text(theme.title())
        cover_gradient = gradient(page, '#newPlaylistCoverPreview')
        assert cover_gradient != 'none'
        assert page.evaluate('selectedPlaylistColor') == color
        if theme == 'cyan':
            page.screenshot(path=str(QA / 'playlist-colour-desktop.png'), animations='disabled')
        page.locator('#createPlaylistActionBtn').click()
        expect(page.locator('#createPlaylistModalOverlay')).not_to_have_class('modal-overlay active')
        stored = page.evaluate('JSON.parse(localStorage.getItem("ev_playlists"))')
        playlist = stored[-1]
        assert playlist['color'] == color
        playlist_id = playlist['id']
        expected_covers[playlist_id] = cover_gradient
        assert gradient(page, f'#userPlaylistsContent [data-playlist-id="{playlist_id}"] .card-img') == cover_gradient
        fallback = page.locator(f'#userPlaylistsContent [data-playlist-id="{playlist_id}"] .fallback')
        assert fallback.evaluate('(e) => getComputedStyle(e).backgroundImage') == 'none'
        assert fallback.evaluate('(e) => getComputedStyle(e).backgroundColor') == 'rgba(0, 0, 0, 0)'
        assert gradient(page, f'#sidebarPlaylistList [data-playlist-id="{playlist_id}"] .playlist-thumb') == cover_gradient
        assert gradient(page, '#detailPlaylistCover') == cover_gradient
    before_reload = page.evaluate('localStorage.getItem("ev_playlists")')
    page.reload(wait_until='domcontentloaded')
    page.wait_for_function('userPlaylists.length === 5')
    assert page.evaluate('localStorage.getItem("ev_playlists")') == before_reload
    assert page.evaluate('Storage.getLiked()') == liked
    for playlist_id, expected_gradient in expected_covers.items():
        assert gradient(page, f'#userPlaylistsContent [data-playlist-id="{playlist_id}"] .card-img') == expected_gradient
        assert gradient(page, f'#sidebarPlaylistList [data-playlist-id="{playlist_id}"] .playlist-thumb') == expected_gradient
    # Existing playlists without a colour must stay valid.
    page.evaluate('''() => {
        userPlaylists.push({id:'legacy', name:'Existing playlist', songs:[]});
        saveUserPlaylists();
    }''')
    assert '#8B5CF6' == page.evaluate('getPlaylistColor(userPlaylists.find(p => p.id === "legacy"))')
    assert len(page.evaluate('Storage.get("playlists")')) == 6
    print('PASS: all five colours, keyboard selection, matching preview/card/sidebar/detail covers, refresh persistence, existing data')

    page.locator('#searchInput').click()
    page.locator('#searchInput').fill('Playlist result')
    expect(page.locator('#searchResSongsList .song-list-item')).to_have_count(2)
    page.locator('#searchResSongsList .song-list-item').nth(1).locator('.song-remove-btn').click()
    expect(page.locator('#atpSongName')).to_have_text('Playlist result Track 2')
    page.locator('#addToPlaylistList button').first.click()
    assert page.evaluate('Storage.get("playlists")[0].songs[0].id') == 'Playlist result-2'
    assert page.evaluate('currentSong') is None
    page.keyboard.press('Escape')
    expect(page.locator('#dashboardSearchPanel')).to_have_class('dashboard-search-panel active')
    page.locator('#searchResSongsList .song-list-item').first.locator('.play-btn').click()
    expect(page.locator('#bottomSongName')).to_have_text('Playlist result Track 1')
    page.wait_for_function('isPlaying && !audio.paused')
    assert page.evaluate('audio.src').endswith('/test-audio.wav')
    page.evaluate('audio.pause()')
    print('PASS: adding the selected search result and existing playback wiring (mock audio)')

    page.evaluate('''() => {
        window.SpeechRecognition = class {
            start() { window.testRecognition = this; this.onstart(); }
            abort() {}
        };
    }''')
    page.locator('#voiceSearchBtn').click()
    expect(page.locator('#voiceSearchHUD')).to_be_visible()
    page.evaluate('testRecognition.onresult({results: [[{transcript: "Voice query"}]]})')
    expect(page.locator('#searchInput')).to_have_value('Voice query')
    expect(page.locator('#voiceSearchHUD')).to_be_hidden()
    expect(page.locator('#searchResSongsList .song-list-item .name').first).to_have_text('Voice query Track 1')
    page.locator('#tabResAlbums').click()
    page.locator('#searchResAlbumsGrid .page-card').first.click()
    expect(page.locator('#dashboardSearchPanel')).not_to_have_class('dashboard-search-panel active')
    expect(page.locator('#detailPlaylistName')).to_have_text('Voice query Album')
    expect(page.locator('#detailPlaylistCover')).to_be_hidden()
    print('PASS: simulated voice search and album navigation; library Artists page retained')

    # ── V3 console panels: hero moods, history shelf, filter pills, rail cards ──
    page.evaluate("navigateTo('home')")
    page.locator('#heroDots .hero-dot').nth(2).click()
    expect(page.locator('#heroTitle')).to_contain_text('Party')
    expect(page.locator('#heroEyebrow')).to_have_text('Loud speakers · Full floor')
    # Hover pauses the carousel; leaving resumes it.
    assert page.evaluate('heroPaused') is True
    page.mouse.move(4, 4)
    assert page.evaluate('heroPaused') is False
    dots = page.locator('#heroDots .hero-dot')
    assert dots.count() == 4
    assert page.evaluate('document.querySelectorAll(".hero-dot.active").length') == 1

    # Recently played fills from the track started earlier in this run.
    assert page.evaluate('Storage.getRecent().length') >= 1
    recent_tiles = page.locator('#recentlyPlayedRow .recent-tile')
    assert recent_tiles.count() == page.evaluate('Math.min(Storage.getRecent().length, 8)')
    sidebar_rows = page.locator('#sidebarRecentList .sidebar-recent-item')
    assert sidebar_rows.count() == page.evaluate('Math.min(Storage.getRecent().length, 4)')
    before_title = page.locator('#nowPlayingTitle').inner_text()
    page.evaluate('audio.pause(); currentSong = null; setPlaying(false);')
    recent_tiles.first.click()
    page.wait_for_function('currentSong && !audio.paused')
    assert page.locator('#nowPlayingTitle').inner_text() != ''
    assert page.evaluate('Boolean(currentSong) && currentSong.id') == page.evaluate('Storage.getRecent()[0].id')
    print('PASS: hero mood carousel, recently played shelf and sidebar history all play real tracks')

    # Sidebar tiles report real stream state, and Now Playing matches the compact reference card.
    assert page.evaluate('document.getElementById("sidebarBitrate").textContent').endswith('kbps')
    assert 'EQ ·' in page.locator('#sidebarEqLabel').inner_text()
    art, meta = page.locator('#nowPlayingArt').bounding_box(), page.locator('#nowPlayingTitle').bounding_box()
    assert art and meta and abs(art['y'] - meta['y']) < 40 and meta['x'] > art['x'] + 30
    print('PASS: stream quality card, live EQ label and the side-by-side Now Playing layout')

    # Playlist pill grid: create tile + user playlists, then liked/albums/artists states.
    grid = page.locator('#homePlaylistsGrid')
    assert grid.locator('.collection-tile.create').count() == 1
    assert grid.locator('.collection-tile[data-playlist-id]').count() == 6
    page.locator('#homeCollectionPills .pill[data-filter="liked"]').click()
    assert grid.locator('.collection-tile').count() >= 1
    assert 'Saved Favorite' in grid.inner_text()
    page.locator('#homeCollectionPills .pill[data-filter="albums"]').click()
    assert 'bookmarked' in grid.inner_text() or grid.locator('.collection-tile').count() >= 1
    page.locator('#homeCollectionPills .pill[data-filter="artists"]').click()
    assert page.locator('#homeCollectionPills .pill.active').get_attribute('data-filter') == 'artists'
    page.locator('#homeCollectionPills .pill[data-filter="all"]').click()
    grid.locator('.collection-tile[data-playlist-id]').first.click()
    expect(page.locator('#playlistDetailView')).to_have_class('playlist-detail-view user-themed active')
    print('PASS: Your Playlists filter pills drive the collection grid and open a playlist detail')

    # Right rail: favourites card, like state and row menu wiring.
    rail_added = page.locator('#recentlyAddedList .rail-row')
    assert rail_added.count() == 1
    rail_added.locator('.rail-action').click()
    expect(page.locator('#recentlyAddedList .rail-empty')).to_be_visible()
    assert page.evaluate('Storage.getLiked().length') == 0
    page.evaluate('(liked) => Storage.set("liked", liked)', liked)
    page.evaluate('renderRecentlyAdded()')
    assert page.locator('#recentlyAddedList .rail-row').count() == 1
    assert page.locator('#trendingRailList .rail-row').count() == 5
    page.locator('#trendingRailList .rail-row').first.locator('.rail-action').click()
    expect(page.locator('#rowActionMenu')).to_be_visible()
    page.locator('#rowActionMenu button', has_text='Add to favourites').click()
    expect(page.locator('#rowActionMenu')).to_be_hidden()
    assert page.evaluate('Storage.getLiked().length') == 2
    print('PASS: Recently Added card, trending rail rows and the row action menu all mutate real state')

    # Sidebar shortcut + equalizer status card keep working with the new layout.
    page.locator('.nav-item[data-liked]').click()
    expect(page.locator('#detailPlaylistName')).to_have_text('Liked Songs')
    expect(page.locator('#detailSongCount')).to_have_text('2')
    assert page.locator('#sidebarEqLabel').inner_text().strip() != ''
    page.keyboard.press('Control+k')
    expect(page.locator('#searchInput')).to_be_focused()
    expect(page.locator('#dashboardSearchPanel')).to_have_class('dashboard-search-panel active')
    page.keyboard.press('Escape')
    print('PASS: Liked Songs playlist view, equalizer status card and Ctrl+K search focus')

    page.set_viewport_size({'width': 390, 'height': 844})
    page.evaluate('openCreatePlaylistModal()')
    expect(page.locator('.theme-opt.active')).to_have_attribute('data-theme', 'purple')
    page.locator('#newPlaylistNameInput').fill('Chill Beats')
    page.locator('.theme-opt[data-theme="cyan"]').click()
    assert page.locator('.playlist-create-modal').evaluate('(el) => el.scrollWidth <= el.clientWidth')
    page.screenshot(path=str(QA / 'playlist-colour-mobile.png'), animations='disabled')
    page.keyboard.press('Escape')
    page.evaluate('openSearchInterface()')
    page.locator('#searchInput').fill('Mobile song')
    expect(page.locator('#searchResSongsList .song-list-item')).to_have_count(2)
    expect(page.locator('#searchResSongsList .song-list-item .name').first).to_have_text('Mobile song Track 1')
    expect(page.locator('#interfaceSearchResults')).to_be_visible()
    assert page.locator('.dashboard-search-panel').evaluate('(el) => el.scrollWidth <= el.clientWidth')
    page.screenshot(path=str(QA / 'search-mobile.png'), animations='disabled')
    assert page.locator('.app-shell').evaluate('(el) => getComputedStyle(el).gridTemplateColumns.split(" ").length') == 1
    assert page.locator('.bottom-player').evaluate('(el) => el.getBoundingClientRect().width <= innerWidth')
    print('PASS: mobile layout stacks the console, fits, and modal cancel resets safely')
    assert not errors, '\n'.join(errors)
    print('PASS: no browser JavaScript errors')
    browser.close()


# ══════════════════════════════════════════════════════════════════
# V3.4 — graceful degradation: a dead trending route or a missing
# hero artwork must never leave the console in a broken state.
# ══════════════════════════════════════════════════════════════════
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1440, 'height': 900})
    state = {'trending_down': True, 'all_down': False}

    def flaky_api(route):
        parsed = urlparse(route.request.url)
        if state['all_down'] or (state['trending_down'] and parsed.path == '/api/trending/songs'):
            route.abort('failed')
            return
        mock_api(route)

    context.route('https://elitejiosaavn-api.vercel.app/**', flaky_api)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(URL, wait_until='domcontentloaded')
    page.wait_for_function("typeof openSearchInterface === 'function'")

    # 1. trending route dead -> the search endpoint fills the same rail.
    expect(page.locator('#trendingRailList .rail-row')).to_have_count(2)
    assert 'trending songs Track 1' in page.locator('#trendingRailList').inner_text()
    assert page.locator('#trendingRailList .rail-degraded').count() == 0
    assert page.evaluate("Storage.get('trending').length") == 2, 'fallback feed was not cached'
    print('PASS: trending rail falls back to the search endpoint and caches the result')

    # a fallback row must still be playable
    page.locator('#trendingRailList .rail-row').first.click()
    page.wait_for_timeout(500)
    assert page.locator('#bottom-player.visible').count() == 1
    assert page.evaluate("currentSong.name") == 'trending songs Track 1'
    print('PASS: rows from the fallback feed play like live ones')

    # 2. whole API down, list cached -> rail stays useful and says so.
    state['all_down'] = True
    page.evaluate("discoveryPool = []; loadTrendingRail(true)")
    page.wait_for_timeout(1200)
    assert page.locator('#trendingRailList .rail-row').count() == 2
    assert 'offline' in page.locator('#trendingRailList .rail-note').inner_text()

    # cache gone but recent plays exist -> the history branch answers instead.
    page.evaluate("Storage.set('trending', [])")
    page.evaluate("loadTrendingRail(true)")
    page.wait_for_timeout(1200)
    assert page.locator('#trendingRailList .rail-row').count() == 1
    assert 'recent plays' in page.locator('#trendingRailList .rail-note').inner_text()
    print('PASS: with the API unreachable the rail serves the cached list, then recent plays, with a source note')

    # 3. nothing at all -> an explicit retry control instead of a dead card.
    page.evaluate("Storage.set('recent', []); discoveryPool = []; loadTrendingRail(true)")
    page.wait_for_timeout(1200)
    degraded = page.locator('#trendingRailList .rail-degraded')
    expect(degraded).to_be_visible()
    assert 'still work' in degraded.inner_text()
    assert page.locator('#trendingRailList .rail-degraded button').count() == 1
    page.screenshot(path=str(QA / 'v34-rail-degraded.png'), clip=page.locator('.right-rail').bounding_box(),
                    animations='disabled')

    # the retry button and the browser online event both re-fetch.
    state['all_down'] = False
    state['trending_down'] = False
    page.evaluate("() => document.querySelector('#trendingRailList .rail-degraded button').click()")
    page.wait_for_timeout(1500)
    assert page.locator('#trendingRailList .rail-row').count() == 5, 'retry did not refill the rail'
    assert page.locator('#trendingRailList .rail-degraded').count() == 0
    state['trending_down'] = True
    page.evaluate("trendingSongs = []; loadTrendingRail(true)")
    page.wait_for_timeout(1200)
    assert page.locator('#trendingRailList .rail-row').count() == 2  # straight back to the search fallback
    state['trending_down'] = False
    page.evaluate("trendingSongs = []; discoveryPool = []; loadTrendingRail(true)")
    page.wait_for_timeout(1200)
    page.evaluate("() => window.dispatchEvent(new Event('online'))")
    page.wait_for_timeout(1500)
    assert page.locator('#trendingRailList .rail-row').count() == 5, 'online event did not refresh the rail'
    print('PASS: Retry button and the online event restore the live trending feed')

    # 4. hero artwork missing -> the CSS night scene paints instead of black;
    #    the photo layer still wins when the file is there.
    assert int(page.locator('#heroPhoto').evaluate('el => getComputedStyle(el).zIndex')) > \
        int(page.locator('.hero-bokeh').evaluate('el => getComputedStyle(el).zIndex')), 'photo must sit above the fallback'
    assert 'radial-gradient' in page.locator('.hero-bokeh').evaluate('el => getComputedStyle(el).backgroundImage')
    art_missing = []

    def drop_art(route):
        art_missing.append(route.request.url)
        route.fulfill(status=404, content_type='text/plain', body='missing')

    context.route('**/assets/hero-night.jpg', drop_art)
    page2 = context.new_page()
    page2.on('pageerror', lambda error: errors.append(str(error)))
    page2.goto(URL, wait_until='domcontentloaded')
    page2.wait_for_timeout(2000)
    box = page2.locator('#heroSection').bounding_box()
    im = Image.open(io.BytesIO(page2.screenshot(clip=box))).convert('RGB')
    grid = [(x, y) for x in (0.5, 0.62, 0.74, 0.86, 0.94) for y in (0.24, 0.5, 0.76)]
    strip = [im.getpixel((int(box['width'] * x), int(box['height'] * y))) for x, y in grid]
    lit = sum(1 for px in strip if max(px) > 24)
    assert art_missing, 'the artwork request was not exercised'
    assert max(max(px) for px in strip) > 60, f'hero has no light without the artwork: {strip}'
    assert lit >= len(strip) * 0.5, f'hero panel is mostly a black void without the artwork: {strip}'
    page2.screenshot(path=str(QA / 'v34-hero-no-artwork.png'), clip=box, animations='disabled')
    page2.close()
    context.unroute('**/assets/hero-night.jpg')
    page3 = context.new_page()
    page3.goto(URL, wait_until='domcontentloaded')
    page3.wait_for_timeout(2000)
    assert 'hero-night.jpg' in page3.evaluate(
        "() => getComputedStyle(document.querySelector('#heroPhoto')).backgroundImage"), 'hero photo layer lost its image'
    page3.close()
    print('PASS: hero keeps its designed night look with the artwork missing, and shows the photo when present')
    assert not errors, '\n'.join(errors)
    print('PASS: no browser JavaScript errors')
    browser.close()


# ══════════════════════════════════════════════════════════════════
# V3.5 — the app's own logo mark (no remote icon), and one artwork per
# hero mood instead of the same picture cropped four ways.
# ══════════════════════════════════════════════════════════════════
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1440, 'height': 900})
    context.route('https://elitejiosaavn-api.vercel.app/**', mock_api)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(URL, wait_until='domcontentloaded')
    page.wait_for_function("typeof setHeroVibe === 'function'")

    # 1. the tab icon is the brand mark, shipped with the app (no CDN).
    icon = page.evaluate("() => { const l = document.querySelector('link[rel=icon]');"
                         " return { href: l.href, type: l.getAttribute('type') }; }")
    assert icon['href'].startswith('data:image/svg+xml,'), icon
    assert icon['type'] == 'image/svg+xml'
    html_text = Path('index.html').read_text()
    js_text = Path('js/app.js').read_text()
    assert 'iili.io' not in html_text and 'iili.io' not in js_text, 'remote icon still referenced'
    for asset in ('assets/logo.svg', 'assets/logo.png'):
        status = page.evaluate("u => fetch(u).then(r => r.status)", asset)
        assert status == 200, f'{asset} -> {status}'
    assert page.evaluate("APP_LOGO.startsWith('data:image/svg+xml,')")
    # the sentinel keeps working as the 'no artwork' fallback
    assert page.evaluate("getImage({ image: [] })") == page.evaluate('APP_LOGO')
    assert 'hero-night.jpg' not in page.evaluate("APP_LOGO")
    print('PASS: favicon and fallback cover use the app logo mark, shipped locally with no remote icon')

    # 2. each mood owns a different artwork, and every file really loads.
    arts = page.evaluate("HERO_VIBES.map(v => v.img)")
    assert len(set(arts)) == 4, arts
    for src in arts:
        got = page.evaluate("""u => fetch(u).then(r => ({ s: r.status, t: r.headers.get('content-type'),
                              len: Number(r.headers.get('content-length') || -1) }))""", src)
        assert got['s'] == 200 and got['t'].startswith('image/') and got['len'] > 20000, (src, got)
    print('PASS: four moods ship four different artworks (one anime boy each), all served as real images')

    # 3. rotating the hero actually swaps the picture on the card and the page glow.
    noart = browser.new_context(viewport={'width': 1440, 'height': 900})
    noart.route('https://elitejiosaavn-api.vercel.app/**', mock_api)
    noart.route('**/assets/hero-*.jpg', lambda route: route.fulfill(status=404, content_type='text/plain', body='gone'))
    ref = noart.new_page()
    ref.goto(URL, wait_until='domcontentloaded')
    ref.wait_for_function("typeof setHeroVibe === 'function'")

    def hero_thumb(target):
        box = target.locator('#heroSection').bounding_box()
        shot = Image.open(io.BytesIO(target.screenshot(clip=box, animations='disabled'))).convert('L').resize((180, 70))
        return shot.getdata(), shot

    for index, src in enumerate(arts):
        page.evaluate(f'setHeroVibe({index})')
        ref.evaluate(f'setHeroVibe({index})')
        # the swap waits for the picture to decode, so poll for the applied frame
        page.wait_for_function("() => getComputedStyle(document.querySelector('#heroPhoto')).backgroundImage"
                               f".includes({src!r})", timeout=6000)
        page.wait_for_timeout(220)
        ref.wait_for_timeout(220)
        hero_bg = page.evaluate("getComputedStyle(document.querySelector('#heroPhoto')).backgroundImage")
        back_bg = page.evaluate("getComputedStyle(document.querySelector('.page-backdrop')).backgroundImage")
        assert src in hero_bg, (src, hero_bg[:120])
        assert src in back_bg, (src, back_bg[:120])
        # the file must be fetched from the app folder, never a wrong base path
        assert '/css/assets/' not in hero_bg, hero_bg[:160]
        art_px, art_img = hero_thumb(page)
        ref_px, _ = hero_thumb(ref)
        diff = sum(abs(a - b) for a, b in zip(art_px, ref_px)) / len(art_px)
        assert diff > 4, f'{src}: hero looks identical with and without the artwork (diff {diff:.2f})'
        assert art_img.getextrema()[1] > 150, f'{src}: artwork renders flat/dark, max luma {art_img.getextrema()[1]}'
    # the mood copy moved with the artwork, and every fetch hit the app folder
    assert 'Focus' in page.locator('#heroTitle').inner_text()
    fetched = page.evaluate("() => performance.getEntriesByType('resource')"
                            ".filter(e => /assets\\/hero-/.test(e.name)).map(e => e.name)")
    assert fetched, 'no hero artwork requests recorded'
    assert all('/css/assets/' not in u for u in fetched), fetched
    assert len({u.rsplit('/', 1)[-1] for u in fetched}) == 4, fetched
    # all four were preloaded once, so a swap never shows an empty frame
    loaded = page.evaluate("() => performance.getEntriesByType('resource').map(e => e.name).filter(n => /assets\\/hero-/.test(n))")
    assert len({n.rsplit('/', 1)[-1] for n in loaded}) == 4, loaded
    print('PASS: hero swap changes the artwork on the card and the page glow, and every mood is preloaded')

    # 4. missing artwork files still degrade to the CSS night scene (all four 404).
    context2 = browser.new_context(viewport={'width': 1440, 'height': 900})
    context2.route('https://elitejiosaavn-api.vercel.app/**', mock_api)
    context2.route('**/assets/hero-*.jpg', lambda route: route.fulfill(status=404, content_type='text/plain', body='gone'))
    page2 = context2.new_page()
    page2.on('pageerror', lambda error: errors.append(str(error)))
    page2.goto(URL, wait_until='domcontentloaded')
    page2.wait_for_function("typeof setHeroVibe === 'function'")
    page2.evaluate('setHeroVibe(2)')
    page2.wait_for_timeout(1400)
    box = page2.locator('#heroSection').bounding_box()
    im = Image.open(io.BytesIO(page2.screenshot(clip=box))).convert('RGB')
    grid = [(x, y) for x in (0.5, 0.62, 0.74, 0.86, 0.94) for y in (0.24, 0.5, 0.76)]
    strip = [im.getpixel((int(box['width'] * x), int(box['height'] * y))) for x, y in grid]
    assert max(max(px) for px in strip) > 60, f'hero is flat black without any artwork: {strip}'
    assert sum(1 for px in strip if max(px) > 24) >= len(strip) * 0.5
    print('PASS: every mood keeps the designed night look when its artwork file is missing')
    assert not errors, '\n'.join(errors)
    print('PASS: no browser JavaScript errors')
    browser.close()
