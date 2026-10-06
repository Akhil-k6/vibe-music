# 🎵 ECCOverse — Music Streaming Console

Aurora-glass music console with integrated search, mood discovery, a real audio
equalizer, playlists, favourites and browser-to-browser sync — no login required.
Everything you save lives in your browser.

## Project structure

```
eccoverse/
├── index.html
├── assets/
│   ├── hero-night.jpg      # hero artwork: Late Night mood + page backdrop
│   ├── hero-rain.jpg       # hero artwork: Monsoon Romance mood
│   ├── hero-party.jpg      # hero artwork: Party Nation mood
│   ├── hero-focus.jpg      # hero artwork: Focus Flow mood
│   ├── logo.svg            # brand mark (favicon is the same mark, inlined)
│   └── logo.png            # 180px copy for Apple touch icons / legacy tabs
├── css/
│   └── style.css
├── js/
│   ├── app.js              # API, dashboard, player, playlists, voice search, sync
│   └── audio-effects.js    # five-band Web Audio processing and the real spectrum
├── tests/
│   ├── test_ui.py          # console/search/playlists/storage/voice UI checks
│   └── test_audio.py       # discovery and measured audio-processing checks
└── README.md
```

**Replacing an existing copy:** update `index.html`, `css/`, `js/` **and** `assets/`
together — `js/audio-effects.js` handles the equalizer and the four `assets/hero-*.jpg`
files are the hero artwork. Nothing else is fetched from a CDN for branding: the tab
icon is the app's own mark, inlined as a data-URI SVG, and the placeholder cover for
saved playlists is the same mark. If `assets/` is left behind the console still looks
intentional — each hero mood paints its own CSS night scene (gradient city lights)
instead of a black rectangle — copy the folder to get the illustrated artwork.
Your saved playlists, favourites and equalizer settings survive because the storage
keys (`ev_playlists`, `ev_liked`, `ev_recent`, `ev_equalizer`, …) are unchanged.
Keep the same browser origin, or move data with the built-in sync code / JSON backup.

## Run it

```bash
python3 -m http.server 8000     # then open http://localhost:8000
```

A network connection is used for the music API, streamed audio, artwork, fonts and
icons. The mic is only needed for voice search and stays behind the browser prompt.

## Interface: one console, three panes

- **Left** — brand, Menu, Your Collection (Playlists, Artists, Albums, Liked Songs),
  your playlists, a Recently Played list, the profile/sync card and a status card that
  shows the actual stream quality of the loaded track plus the live EQ state, with bars
  driven by the analyser.
- **Center** — the dashboard header search, the page sections and the floating player
  bar. Search results render *inside* this column: no overlay, no second search field,
  no separate search page.
- **Right** — Now Playing (compact artwork + title row, live meter, seek line,
  transport, add-to-playlist, equalizer), Trending Now and Recently Added.
- The photographic night backdrop sits behind blurred glass panels; on phones the
  three panes stack and the equalizer stays reachable from the player bar.

## Feature notes

**Search, merged with the dashboard.** One transparent, borderless field in the
header (`/`, `S` or `Ctrl`/`Cmd`+`K` focuses it). Trending and recent search chips,
then **All Results / Songs / Albums** filters with playback and Add-to-playlist
buttons on each row; `Esc` closes results while audio keeps playing. Artist result
cards stay removed; the Artists library is untouched.

**Hero moods and discovery.** The hero card rotates through four curated moods,
and each mood carries its own artwork — a different anime listener per scene: night
city lights, monsoon window, rooftop party, desk at first light. Swaps wait for the
next picture to decode, so a rotation never flashes an empty frame, and all four are
preloaded on start-up (auto-advance pauses on hover/focus and inside dialogs). **Play Now** discovers a
*different* track each time from the selected mood's shuffled pool, skipping the
current song and the last 20 played; **Save Playlist** turns the mood into a real
playlist in your library. Ordinary pause/resume lives in the player controls,
the Now Playing card and media keys.

**The rail never dead-ends.** **Trending Now** resolves in order: the trending
endpoint, then a `trending songs` search on the same API (a different route, so a
single broken endpoint still yields real tracks), then the live discovery pool, then
the last list that loaded from local storage, then your recent plays — non-live sources
are labelled, so you always know what you are looking at. Successful feeds are cached,
a `Retry` button appears if nothing is reachable, and the rail reloads by itself when
the browser reports it is back online. Playback, search and your library never depend
on it.

**Equalizer that actually processes audio.** Five bands — 60 Hz, 250 Hz, 1 kHz,
4 kHz, 12 kHz, each ±12 dB — with Flat / Bass Boost / Vocal / Pop / Rock presets,
custom gains, on/off bypass, Reset to Flat and saved settings. Signal path: media
source → headroom preamp → shelf/peaking filters → peak limiter → analyser → output.
Every meter in the app is analyser-driven and rests on pause and during silence.
Streams that deny cross-origin audio fall back to untouched native playback with the
controls disabled and an explicit status message, so nothing plays silently.

**Your library.** Playlists keep the five cover colours (Purple `#8B5CF6`,
Cyan `#06B6D4`, Pink `#EC4899`, Amber `#F59E0B`, Emerald `#10B981`) consistently in
the picker preview, cards, sidebar rows and the detail header. The **Your Playlists**
pills filter between your playlists, liked songs, bookmarked albums and artists
(the last two fill as you open them). Favourites, queue playback, shuffle, repeat,
seek, volume, spinning artwork, media session, sync codes and JSON backup all remain.

## Optional regression checks

No test dependency is needed to use the app. To re-run the browser checks against a
server on port 8000:

```bash
python3 -m pip install playwright
python3 -m playwright install --with-deps chromium
python3 tests/test_ui.py
python3 tests/test_audio.py
```

They cover the merged search console, the five playlist colours and storage,
voice/album flows, mobile stacking, hero discovery variety, playback-request races
and measured audio: a 1 kHz test tone is attenuated to ≈0.25 of its flat level by a
−12 dB band, bypass returns it to unity, silence keeps the bars down, and a CORS-
denied stream proves the native fallback still plays. Mocked API responses and
simulated speech are used, so the external service and real microphone hardware are
outside their scope.
