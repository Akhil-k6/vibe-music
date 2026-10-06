/* ══════════════════════════════════════════════════════════════
   ECCOVERSE PRO — APPLICATION CORE v2.0
   API: https://elitejiosaavn-api.vercel.app (UNCHANGED)
   ══════════════════════════════════════════════════════════════ */

'use strict';

// ─── CONFIGURATION ─────────────────────────────────────────────
const API = 'https://elitejiosaavn-api.vercel.app';
const APP_LOGO = 'data:image/svg+xml,%3C%3Fxml version=%221.0%22 encoding=%22UTF-8%22%3F%3E%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 64 64%22 width=%2264%22 height=%2264%22%3E%3Crect width=%2264%22 height=%2264%22 rx=%2220%22 fill=%22%23c9c5fb%22/%3E%3Cpath d=%22M11 32H17V21H27V43H37V25H45V32H53%22 fill=%22none%22 stroke=%22%23181a24%22 stroke-width=%225.2%22 stroke-linecap=%22square%22 stroke-linejoin=%22miter%22/%3E%3C/svg%3E';
const PLAYLIST_THEMES = {
    purple: { name: 'Purple', color: '#8B5CF6', dark: '#6D28D9' },
    cyan: { name: 'Cyan', color: '#06B6D4', dark: '#0891B2' },
    pink: { name: 'Pink', color: '#EC4899', dark: '#BE185D' },
    amber: { name: 'Amber', color: '#F59E0B', dark: '#D97706' },
    emerald: { name: 'Emerald', color: '#10B981', dark: '#059669' }
};

// ─── STATE ─────────────────────────────────────────────────────
let currentSong = null;
let currentQueue = [];
let currentIndex = 0;
let isPlaying = false;
let shuffleEnabled = false;
let repeatEnabled = false;
let isLiked = false;
let userPlaylists = [];
let addToPlaylistSong = null;
let lastVolume = 80;
let isMuted = false;
let detailCurrentSongs = [];
let audio = document.getElementById('audioPlayer');
let playbackRequestVersion = 0;
let isLoadingSong = false;

// ─── STORAGE ────────────────────────────────────────────────────
const Storage = {
    get(k) { try { return JSON.parse(localStorage.getItem('ev_' + k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('ev_' + k, JSON.stringify(v)); } catch (e) {} },
    getLiked() { return this.get('liked') || []; },
    getRecent() { return this.get('recent') || [] }
};

// ─── TOAST ──────────────────────────────────────────────────────
let toastTimeout;
function showToast(msg, dur = 1600) {
    const existing = document.querySelector('.toast-msg');
    if (existing) existing.remove();
    const t = document.createElement('div');
    t.className = 'toast-msg';
    t.innerHTML = `<i class="fas fa-circle-info" style="color:var(--primary)"></i>${escapeHtml(msg)}`;
    document.body.appendChild(t);
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        t.style.opacity = '0';
        t.style.transform = 'translateX(-50%) translateY(14px)';
        t.style.transition = 'all 0.3s';
        setTimeout(() => t.remove(), 300);
    }, dur);
}

// ─── BULLETPROOF API HELPER (anti-stall race) ───────────────────
function callApi(endpoint, params) {
    const qs = Object.keys(params || {})
        .filter(k => params[k] !== undefined && params[k] !== null)
        .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
    const url = API + endpoint + (qs ? '?' + qs : '');

    return Promise.race([
        fetch(url, { signal: AbortSignal.timeout(10000) })
            .then(r => {
                if (!r.ok) { if (r.status === 404) return null; throw new Error('HTTP ' + r.status); }
                return r.json();
            })
            .then(d => d.success ? d.data : null),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Manual timeout')), 6000))
    ]).catch(e => {
        console.warn('API error or timeout:', e);
        return null;
    });
}

// ─── HELPERS ────────────────────────────────────────────────────
function getImage(item) {
    const imgs = item.image || [];
    const best = imgs.find(x => x.quality === '500x500') || imgs.find(x => x.quality === '150x150') || imgs[imgs.length - 1];
    return (best && best.url) || APP_LOGO;
}
// Keep the existing `color` field, including playlists restored from backups.
function getPlaylistColor(playlist) {
    const color = playlist && playlist.color;
    return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)
        ? color.toUpperCase() : PLAYLIST_THEMES.purple.color;
}
function getPlaylistCoverGradient(color) {
    const safeColor = getPlaylistColor({ color });
    const theme = Object.values(PLAYLIST_THEMES).find(t => t.color === safeColor);
    const dark = theme ? theme.dark : '#0F0C23';
    return `linear-gradient(135deg, ${safeColor} 0%, ${dark} 58%, #0F0C23 100%)`;
}
function getArtistImage(item) {
    const imgs = item.image || [];
    const best = imgs.find(x => x.quality === '500x500') || imgs.find(x => x.quality === '150x150') || imgs[imgs.length - 1];
    return (best && best.url) || APP_LOGO;
}
function getDownloadUrl(item) {
    const dl = item.downloadUrl || [];
    const best = dl.find(x => x.quality === '320kbps') || dl.find(x => x.quality === '160kbps') || dl[dl.length - 1];
    return (best && best.url) || '';
}
function getDownloadQuality(item) {
    const dl = (item && item.downloadUrl) || [];
    const best = dl.find(x => x.quality === '320kbps') || dl.find(x => x.quality === '160kbps') || dl[dl.length - 1];
    return (best && best.quality) || '';
}
function updateStreamQuality(song) {
    const value = document.getElementById('sidebarBitrate');
    const sub = document.getElementById('sidebarBitrateSub');
    if (!value || !sub) return;
    const quality = getDownloadQuality(song);
    if (quality) {
        value.textContent = quality.replace('kbps', '') + ' kbps';
        sub.textContent = (song && song.explicit ? 'Explicit · ' : '') + 'streamed at this quality';
    } else {
        value.textContent = '— kbps';
        sub.textContent = 'Pick a song for stream quality';
    }
}
function getArtistName(song) {
    if (song.artists?.primary?.length) { const n = song.artists.primary.map(a => a.name); return n.length > 2 ? n.slice(0, 2).join(', ') + '...' : n.join(', '); }
    if (song.primaryArtists) { const parts = song.primaryArtists.replace(/&amp;/g, '&').split(',').map(s => s.trim()); return parts.length > 2 ? parts.slice(0, 2).join(', ') + '...' : parts.join(', '); }
    if (song.singers) { const parts = song.singers.replace(/&amp;/g, '&').split(',').map(s => s.trim()); return parts.length > 2 ? parts.slice(0, 2).join(', ') + '...' : parts.join(', '); }
    return '—';
}
function getAlbumArtists(album) {
    if (album.artists?.primary?.length) { const n = album.artists.primary.map(a => a.name); return n.length > 2 ? n.slice(0, 2).join(', ') + '...' : n.join(', '); }
    if (album.artist) return album.artist;
    if (album.artists?.length) { const n = album.artists.map(a => a.name || a); return n.length > 2 ? n.slice(0, 2).join(', ') + '...' : n.join(', '); }
    if (album.primaryArtist) return album.primaryArtist;
    if (album.subtitle) return album.subtitle;
    return '—';
}
function formatTime(s) {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = String(Math.floor(s % 60)).padStart(2, '0');
    return m + ':' + sec;
}
function durationMarkup(song) {
    // Aggregate search rows have no duration; show nothing rather than "--:--".
    if (!song || !song.duration || isNaN(song.duration)) return '';
    return `<span class="duration">${formatTime(song.duration)}</span>`;
}
function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function isSongLiked(song) { return song && Storage.getLiked().some(s => s.id === song.id); }
function setSkeletonGrid(container, count) {
    container.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'page-grid';
    for (let i = 0; i < count; i++) {
        const sk = document.createElement('div');
        sk.className = 'skeleton-card';
        sk.innerHTML = '<div class="skeleton-img"></div><div class="skeleton-line w60"></div><div class="skeleton-line w40"></div>';
        grid.appendChild(sk);
    }
    container.appendChild(grid);
}

// ─── NAVIGATION ─────────────────────────────────────────────────
const pageMap = { home: 'page-home', explore: 'page-explore', library: 'page-library', favorites: 'page-favorites', playlists: 'page-playlists', artists: 'page-artists', albums: 'page-albums' };
function navigateTo(p) {
    document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === p));
    Object.keys(pageMap).forEach(k => {
        const el = document.getElementById(pageMap[k]);
        if (el) el.classList.toggle('active', k === p);
    });
    if (p !== 'playlists') closePlaylistDetail();
    if (p !== 'artists') closeArtistDetail();
    closeSearchInterface();
    document.getElementById('contentArea').scrollTop = 0;
    switch (p) {
        case 'explore': loadExplore(); break;
        case 'artists': loadArtists(); break;
        case 'albums': loadAlbums(); break;
        case 'playlists': loadPlaylistsPage(); break;
        case 'favorites': loadFavorites(); break;
        case 'library': loadLibrary(); break;
        default: break;
    }
}
let activeDetailPlaylistId = null;

function closePlaylistDetail() {
    const view = document.getElementById('playlistDetailView');
    if (view) view.classList.remove('active');
    activeDetailPlaylistId = null;
}

let artistDetailCurrentSongs = [];

function closeArtistDetail() {
    const view = document.getElementById('artistDetailView');
    if (view) view.classList.remove('active');
    const content = document.getElementById('artistsContent');
    if (content) content.style.display = 'block';
}

function showArtistDetail(artist, songs) {
    artistDetailCurrentSongs = songs || [];
    recordSeen('artists', artist);
    const view = document.getElementById('artistDetailView');
    const content = document.getElementById('artistsContent');
    if (content) content.style.display = 'none';

    const name = artist.name || 'Artist';
    const img = getArtistImage(artist);

    document.getElementById('detailArtistName').textContent = name;
    const avatar = document.getElementById('artistDetailAvatar');
    if (avatar) avatar.style.backgroundImage = `url('${img}')`;

    const list = document.getElementById('artistDetailSongList');
    list.innerHTML = '';

    if (!songs || !songs.length) {
        list.innerHTML = '<div class="empty-state"><i class="fas fa-music"></i><p>No songs found for this artist</p></div>';
        view.classList.add('active');
        return;
    }

    songs.forEach((song, i) => {
        const div = document.createElement('div');
        div.className = 'song-list-item';
        const sImg = getImage(song);
        const sName = song.name || song.title || 'Unknown';
        const sArtist = getArtistName(song);
        const dur = song.duration ? formatTime(song.duration) : '--:--';

        div.innerHTML = `
            <span class="index">${i + 1}</span>
            <div class="thumb">${sImg !== APP_LOGO ? `<img src="${sImg}" alt="${escapeHtml(sName)}" loading="lazy">` : '<i class="fas fa-music"></i>'}</div>
            <div class="info"><div class="name">${escapeHtml(sName)}</div><div class="artist">${escapeHtml(sArtist)}</div></div>
            <span class="duration">${dur}</span>
            <button class="play-btn" title="Play"><i class="fas fa-play"></i></button>
        `;
        div.onclick = () => startPlay(song, songs, i);
        list.appendChild(div);
    });

    view.classList.add('active');
    view.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function playArtistDetailFirst() {
    if (artistDetailCurrentSongs.length) startPlay(artistDetailCurrentSongs[0], artistDetailCurrentSongs, 0);
    else showToast('No songs to play');
}

// ─── PLAYLIST DETAIL ────────────────────────────────────────────
function showPlaylistDetail(playlist, songs, singer, isUserPlaylist = false) {
    const view = document.getElementById('playlistDetailView');
    detailCurrentSongs = songs || [];
    activeDetailPlaylistId = isUserPlaylist ? playlist.id : null;
    view.classList.toggle('user-themed', isUserPlaylist);
    const color = getPlaylistColor(playlist);
    view.style.setProperty('--playlist-detail-color', color);
    const cover = document.getElementById('detailPlaylistCover');
    if (cover) {
        cover.style.display = isUserPlaylist ? 'flex' : 'none';
        cover.style.background = getPlaylistCoverGradient(color);
    }

    document.getElementById('detailPlaylistName').textContent = playlist.name || 'Playlist';
    document.getElementById('detailSingerName').textContent = singer || 'Various';
    document.getElementById('detailSongCount').textContent = songs ? songs.length : 0;

    const deleteBtn = document.getElementById('deletePlaylistDetailBtn');
    if (deleteBtn) deleteBtn.style.display = isUserPlaylist ? 'inline-flex' : 'none';

    const list = document.getElementById('detailSongList');
    list.innerHTML = '';

    if (!songs || !songs.length) {
        list.innerHTML = '<div class="empty-state"><i class="fas fa-music"></i><p>No songs here yet. Add songs using ♥ or + in player.</p></div>';
        view.classList.add('active');
        return;
    }

    songs.forEach((song, i) => {
        const div = document.createElement('div');
        div.className = 'song-list-item';
        const img = getImage(song);
        const name = song.name || song.title || 'Unknown';
        const artist = getArtistName(song);
        const dur = song.duration ? formatTime(song.duration) : '--:--';

        const removeBtnHTML = isUserPlaylist ? `
            <button class="song-remove-btn" onclick="removeSongFromUserPlaylist(event, '${escapeHtml(playlist.id)}', '${escapeHtml(song.id)}')" title="Remove from playlist">
                <i class="fas fa-trash-can"></i>
            </button>
        ` : '';

        div.innerHTML = `
            <span class="index">${i + 1}</span>
            <div class="thumb">${img !== APP_LOGO ? `<img src="${img}" alt="${escapeHtml(name)}" loading="lazy">` : '<i class="fas fa-music"></i>'}</div>
            <div class="info"><div class="name">${escapeHtml(name)}</div><div class="artist">${escapeHtml(artist)}</div></div>
            <span class="duration">${dur}</span>
            <button class="play-btn" title="Play"><i class="fas fa-play"></i></button>
            ${removeBtnHTML}
        `;
        div.onclick = (e) => {
            if (e.target.closest('.song-remove-btn')) return;
            startPlay(song, songs, i);
        };
        list.appendChild(div);
    });
    view.classList.add('active');
    view.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function playDetailFirst() {
    if (detailCurrentSongs.length) startPlay(detailCurrentSongs[0], detailCurrentSongs, 0);
    else showToast('No songs to play');
}
function viewAllPlaylists() { navigateTo('playlists'); }

// ─── PLAYLISTS PAGE ─────────────────────────────────────────────
function loadPlaylistsPage() {
    loadUserPlaylists();
    loadGlobalPlaylists();
}

async function loadGlobalPlaylists() {
    const container = document.getElementById('playlistsContent');
    setSkeletonGrid(container, 8);

    const FALLBACK = [
        { id: 'fallback_1', name: 'Top Bollywood Hits', subtitle: 'Latest Hindi Songs', songCount: '50' },
        { id: 'fallback_2', name: 'Global Pop Hits', subtitle: 'Trending Worldwide', songCount: '100' },
        { id: 'fallback_3', name: 'Chill Lofi Beats', subtitle: 'Relax & Study', songCount: '80' },
        { id: 'fallback_4', name: 'Workout Motivation', subtitle: 'High Energy', songCount: '60' },
        { id: 'fallback_5', name: 'Romantic Duets', subtitle: 'Love Songs', songCount: '40' },
        { id: 'fallback_6', name: 'Classic Rock', subtitle: 'Timeless Hits', songCount: '70' }
    ];
    const GRADS = ['#8B5CF6', '#EC4899', '#F59E0B', '#3B82F6', '#10B981', '#EF4444'];

    function renderGrid(items) {
        container.innerHTML = '';
        const grid = document.createElement('div');
        grid.className = 'page-grid';
        items.slice(0, 20).forEach((pl, idx) => {
            const card = document.createElement('div');
            card.className = 'page-card';
            const color = GRADS[idx % GRADS.length];
            const img = getImage(pl);
            const singer = pl.subtitle || 'Various Artists';
            const name = pl.name || 'Untitled Playlist';
            card.innerHTML = `
                <div class="card-img" style="background:${img !== APP_LOGO ? `url('${img}')` : `linear-gradient(135deg, ${color}, ${color}bb)`};background-size:cover;background-position:center;">
                    ${img === APP_LOGO ? '<div class="fallback"><i class="fas fa-list-music"></i></div>' : ''}
                </div>
                <div class="name">${escapeHtml(name)}</div>
                <div class="singer-tag">${escapeHtml(singer)}</div>
                <div class="sub">${pl.songCount || 'Playlist'}</div>
            `;
            card.onclick = () => openPlaylist(pl, singer);
            grid.appendChild(card);
        });
        container.appendChild(grid);
    }

    async function openPlaylist(pl, singer) {
        showToast('Loading ' + pl.name);
        if (pl.id && String(pl.id).startsWith('fallback_')) {
            const fakeSongs = [];
            for (let i = 0; i < 10; i++) {
                fakeSongs.push({
                    id: 'fake_' + pl.id + '_' + i,
                    title: pl.name + ' — Track ' + (i + 1),
                    name: pl.name + ' — Track ' + (i + 1),
                    image: [{ url: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=500&h=500&fit=crop', quality: '500x500' }],
                    artists: { primary: [{ name: singer }] },
                    primaryArtists: singer,
                    downloadUrl: [{ quality: '160kbps', url: '' }],
                    duration: 180 + i * 20
                });
            }
            showPlaylistDetail(pl, fakeSongs, singer);
            navigateTo('playlists');
            return;
        }
        const d = await callApi('/api/playlists', { id: pl.id, page: 0, limit: 50 });
        if (d && d.songs && d.songs.length) { showPlaylistDetail(pl, d.songs, singer); return; }
        const sd = await callApi('/api/search/songs', { query: pl.name, page: 0, limit: 20 });
        const songs = (sd && sd.results) || [];
        if (songs.length) showPlaylistDetail(pl, songs, singer);
        else showToast('No songs available for this playlist');
    }

    try {
        const data = await callApi('/api/trending/playlists', { page: 1, limit: 100 });
        let items = (data && data.results) || [];
        if (!items.length) items = FALLBACK;
        renderGrid(items);
    } catch (e) {
        console.error('Global playlists error, using fallback:', e);
        renderGrid(FALLBACK);
    }
}

// ─── USER PLAYLISTS (LOCAL & DELETE) ───────────────────────────
function loadUserPlaylists() {
    const data = localStorage.getItem('ev_playlists');
    try { userPlaylists = data ? JSON.parse(data) : []; } catch (e) { userPlaylists = []; }
    updateUserPlaylistsUI();
    updateSidebarPlaylists();
    renderHomeCollections();
}

function deleteUserPlaylist(event, playlistId) {
    if (event) event.stopPropagation();
    const pl = userPlaylists.find(p => String(p.id) === String(playlistId));
    if (!pl) return;
    showConfirmDeleteModal(
        'Delete Playlist',
        `Are you sure you want to delete playlist "${pl.name}"?`,
        function() {
            userPlaylists = userPlaylists.filter(p => String(p.id) !== String(playlistId));
            saveUserPlaylists();
            if (activeDetailPlaylistId && String(activeDetailPlaylistId) === String(playlistId)) {
                closePlaylistDetail();
            }
            showToast(`Deleted playlist "${pl.name}"`);
        }
    );
}

function deleteCurrentDetailPlaylist() {
    if (!activeDetailPlaylistId) return;
    deleteUserPlaylist(null, activeDetailPlaylistId);
}

function removeSongFromUserPlaylist(event, playlistId, songId) {
    if (event) event.stopPropagation();
    const pl = userPlaylists.find(p => String(p.id) === String(playlistId));
    if (!pl) return;
    pl.songs = (pl.songs || []).filter(s => String(s.id) !== String(songId));
    saveUserPlaylists();
    showPlaylistDetail(pl, pl.songs, 'Your Playlist', true);
    showToast(`Removed song from "${pl.name}"`);
}

function updateUserPlaylistsUI() {
    const c = document.getElementById('userPlaylistsContent');
    if (!c) return;
    if (!userPlaylists.length) {
        c.innerHTML = `
            <div class="empty-state" style="padding:32px 20px; background:var(--glass-bg); border:1px dashed var(--glass-border); border-radius:var(--radius); text-align:center;">
                <i class="fas fa-folder-plus" style="font-size:32px; color:var(--primary); margin-bottom:12px;"></i>
                <p style="font-size:15px; font-weight:700; color:var(--text-white); margin-bottom:4px;">No playlists created yet</p>
                <p style="font-size:12.5px; color:var(--text-grey); margin-bottom:18px;">Organize your favorite music into custom collections</p>
                <button class="sync-btn-primary" onclick="openCreatePlaylistModal()" style="margin:0 auto;"><i class="fas fa-plus"></i> Create Your First Playlist</button>
            </div>
        `;
        return;
    }
    const grid = document.createElement('div');
    grid.className = 'page-grid';
    userPlaylists.forEach(pl => {
        const card = document.createElement('div');
        card.className = 'page-card';
        const songCount = pl.songs ? pl.songs.length : 0;
        const color = getPlaylistColor(pl);
        card.dataset.playlistId = pl.id;
        card.innerHTML = `
            <button class="card-delete-btn" onclick="deleteUserPlaylist(event, '${escapeHtml(pl.id)}')" title="Delete Playlist">
                <i class="fas fa-trash-can"></i>
            </button>
            <div class="card-img" style="background:${getPlaylistCoverGradient(color)};">
                <div class="fallback"><i class="fas fa-music"></i></div>
            </div>
            <div class="name">${escapeHtml(pl.name)}</div>
            <div class="singer-tag">Your Playlist</div>
            <div class="sub">${songCount} songs</div>
        `;
        card.onclick = () => {
            showPlaylistDetail(pl, pl.songs || [], 'Your Playlist', true);
        };
        grid.appendChild(card);
    });
    c.innerHTML = '';
    c.appendChild(grid);
}

function updateSidebarPlaylists() {
    const c = document.getElementById('sidebarPlaylistList');
    if (!c) return;
    c.innerHTML = '';
    if (!userPlaylists.length) {
        c.innerHTML = '<div style="padding:8px 12px;color:var(--text-muted);font-size:11px;">No playlists yet</div>';
        return;
    }
    userPlaylists.slice(0, 8).forEach(pl => {
        const btn = document.createElement('div');
        btn.className = 'playlist-item';
        btn.dataset.playlistId = pl.id;
        btn.style.display = 'flex';
        btn.style.alignItems = 'center';
        btn.style.justifyContent = 'space-between';
        btn.style.padding = '6px 8px';
        btn.innerHTML = `
            <div style="display:flex; align-items:center; gap:8px; overflow:hidden; flex:1; cursor:pointer;" onclick="openSidebarPlaylist('${escapeHtml(pl.id)}')">
                <div class="playlist-thumb" style="background:${getPlaylistCoverGradient(getPlaylistColor(pl))}; color:#fff;"><i class="fas fa-music"></i></div>
                <div class="playlist-info" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(pl.name)}</div>
            </div>
            <button class="song-remove-btn" onclick="deleteUserPlaylist(event, '${escapeHtml(pl.id)}')" title="Delete" style="opacity:0.6; font-size:11px; width:22px; height:22px;">
                <i class="fas fa-trash-can"></i>
            </button>
        `;
        c.appendChild(btn);
    });
}

function openSidebarPlaylist(plId) {
    const pl = userPlaylists.find(p => String(p.id) === String(plId));
    if (pl) {
        showPlaylistDetail(pl, pl.songs || [], 'Your Playlist', true);
        navigateTo('playlists');
    }
}

function saveUserPlaylists() {
    localStorage.setItem('ev_playlists', JSON.stringify(userPlaylists));
    loadUserPlaylists();
}

let selectedPlaylistColor = '#8B5CF6';

function openCreatePlaylistModal() {
    const modal = document.getElementById('createPlaylistModalOverlay');
    if (!modal) return;
    if (modal.classList.contains('active')) return;
    const input = document.getElementById('newPlaylistNameInput');
    if (input) input.value = '';
    // Reset both the visual selection and the saved colour for a new playlist.
    selectPlaylistTheme(modal.querySelector('[data-theme="purple"]'));
    modal.classList.add('active');
    if (input) input.focus();
}

function closeCreatePlaylistModal(event) {
    if (event && event.target !== event.currentTarget) return;
    const modal = document.getElementById('createPlaylistModalOverlay');
    if (modal) modal.classList.remove('active');
}

function selectPlaylistTheme(el, color) {
    const modal = document.getElementById('createPlaylistModalOverlay');
    if (!modal) return;
    const chosenColor = color || (el && el.dataset.color);
    const theme = Object.values(PLAYLIST_THEMES).find(t =>
        t.color.toLowerCase() === String(chosenColor).toLowerCase()
    ) || PLAYLIST_THEMES.purple;
    selectedPlaylistColor = theme.color;

    modal.querySelectorAll('.theme-opt').forEach(opt => {
        const selected = opt.dataset.color === theme.color;
        opt.classList.toggle('active', selected);
        opt.setAttribute('aria-pressed', String(selected));
    });

    const panel = modal.querySelector('.playlist-create-modal');
    if (panel) {
        panel.style.setProperty('--playlist-color', theme.color);
        panel.style.setProperty('--playlist-dark', theme.dark);
        panel.style.setProperty('--playlist-glow', theme.color + '55');
        panel.style.setProperty('--playlist-cover', getPlaylistCoverGradient(theme.color));
    }
    const label = document.getElementById('selectedPlaylistThemeName');
    if (label) label.textContent = theme.name;
    updatePlaylistCoverPreview();
}

function updatePlaylistCoverPreview() {
    const input = document.getElementById('newPlaylistNameInput');
    const previewName = document.getElementById('newPlaylistPreviewName');
    if (previewName) previewName.textContent = (input && input.value.trim()) || 'Your new playlist';
}

function confirmCreatePlaylist() {
    const input = document.getElementById('newPlaylistNameInput');
    const name = input ? input.value.trim() : '';
    if (!name) {
        showToast('Please enter a playlist name');
        return;
    }

    const newPl = {
        id: Date.now().toString(),
        name: name,
        color: getPlaylistColor({ color: selectedPlaylistColor }),
        songs: []
    };

    userPlaylists.push(newPl);
    saveUserPlaylists();
    closeCreatePlaylistModal();
    showToast('✅ Created playlist: "' + name + '"', 2000);

    const pagePlaylists = document.getElementById('page-playlists');
    if (pagePlaylists && pagePlaylists.classList.contains('active')) {
        showPlaylistDetail(newPl, [], 'Your Playlist', true);
    }
}

function createNewPlaylist() {
    openCreatePlaylistModal();
}

function addToPlaylist() {
    if (!currentSong) { showToast('No song playing'); return; }
    openAddToPlaylistModal(currentSong);
}

function openAddToPlaylistModal(song) {
    if (!song) return;
    addToPlaylistSong = song;
    const modal = document.getElementById('addToPlaylistModalOverlay');
    if (!modal) return;

    const img = getImage(song);
    const name = song.name || song.title || 'Untitled';
    const artist = getArtistName(song);

    const imgEl = document.getElementById('atpSongImg');
    if (imgEl) imgEl.style.backgroundImage = `url('${img}')`;
    document.getElementById('atpSongName').textContent = name;
    document.getElementById('atpSongArtist').textContent = artist;

    renderAddToPlaylistList(song);
    modal.classList.add('active');
}

function closeAddToPlaylistModal(event) {
    if (event && event.target !== event.currentTarget) return;
    const modal = document.getElementById('addToPlaylistModalOverlay');
    if (modal) modal.classList.remove('active');
    addToPlaylistSong = null;
}

function renderAddToPlaylistList(song) {
    const container = document.getElementById('addToPlaylistList');
    if (!container) return;
    container.innerHTML = '';

    if (!userPlaylists.length) {
        container.innerHTML = '<div style="text-align:center; padding:16px; color:var(--text-grey); font-size:12.5px;">No playlists created yet. Create one below!</div>';
        return;
    }

    userPlaylists.forEach(pl => {
        const hasSong = (pl.songs || []).some(s => String(s.id) === String(song.id));
        const item = document.createElement('div');
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.justifyContent = 'space-between';
        item.style.padding = '10px 14px';
        item.style.background = 'var(--glass-bg)';
        item.style.border = '1px solid var(--glass-border)';
        item.style.borderRadius = '10px';

        item.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px; overflow:hidden;">
                <div style="width:32px; height:32px; border-radius:8px; background:${getPlaylistCoverGradient(getPlaylistColor(pl))}; display:flex; align-items:center; justify-content:center; color:#fff; font-size:12px; flex-shrink:0;">
                    <i class="fas fa-music"></i>
                </div>
                <div style="overflow:hidden;">
                    <div style="font-weight:700; font-size:13px; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(pl.name)}</div>
                    <div style="font-size:11px; color:var(--text-muted);">${(pl.songs || []).length} songs</div>
                </div>
            </div>
            <button class="${hasSong ? 'ghost-btn' : 'sync-btn-primary'}" style="padding:6px 12px; font-size:12px; flex-shrink:0;" onclick="toggleSongInPlaylist('${escapeHtml(pl.id)}')">
                ${hasSong ? '<i class="fas fa-check" style="color:#10B981;"></i> Added' : '<i class="fas fa-plus"></i> Add'}
            </button>
        `;
        container.appendChild(item);
    });
}

function toggleSongInPlaylist(playlistId) {
    const song = addToPlaylistSong;
    if (!song) return;
    const pl = userPlaylists.find(p => String(p.id) === String(playlistId));
    if (!pl) return;
    if (!pl.songs) pl.songs = [];

    const index = pl.songs.findIndex(s => String(s.id) === String(song.id));
    if (index >= 0) {
        pl.songs.splice(index, 1);
        showToast(`Removed from "${pl.name}"`);
    } else {
        pl.songs.push(song);
        showToast(`Added to "${pl.name}"`);
    }
    saveUserPlaylists();
    renderAddToPlaylistList(song);
}

// ─── ARTISTS / ALBUMS / FAVORITES / LIBRARY / EXPLORE ───────────
async function loadArtists() {
    const c = document.getElementById('artistsContent');
    setSkeletonGrid(c, 10);
    const data = await callApi('/api/trending/artists', { page: 1, limit: 100 });
    const items = (data && data.results) || [];
    c.innerHTML = '';
    if (!items.length) { c.innerHTML = '<div class="empty-state"><i class="fas fa-microphone-lines"></i><p>No artists</p></div>'; return; }
    const grid = document.createElement('div');
    grid.className = 'page-grid';
    items.slice(0, 50).forEach(art => {
        const card = document.createElement('div');
        card.className = 'page-card';
        const img = getArtistImage(art);
        card.innerHTML = `
            <div class="card-img" style="background:${img !== APP_LOGO ? `url('${img}')` : 'linear-gradient(135deg,var(--secondary),#C026D3)'};background-size:cover;background-position:center;border-radius:50%;width:85%;margin:0 auto 10px;">
                ${img === APP_LOGO ? '<div class="fallback" style="border-radius:50%;"><i class="fas fa-user"></i></div>' : ''}
            </div>
            <div class="name">${escapeHtml(art.name)}</div>
            <div class="sub">${art.followerCount || 'Popular Artist'}</div>
        `;
        card.onclick = async () => {
            showToast('Loading ' + art.name);
            const d = await callApi('/api/artists/' + art.id + '/songs', { page: 0, limit: 30 });
            if (d && d.songs && d.songs.length) {
                showArtistDetail(art, d.songs);
            } else showToast('No songs found for ' + art.name);
        };
        grid.appendChild(card);
    });
    c.appendChild(grid);
}

async function loadAlbums() {
    const c = document.getElementById('albumsContent');
    setSkeletonGrid(c, 10);
    const data = await callApi('/api/trending/albums', { page: 1, limit: 100 });
    const items = (data && data.results) || [];
    c.innerHTML = '';
    if (!items.length) { c.innerHTML = '<div class="empty-state"><i class="fas fa-compact-disc"></i><p>No albums</p></div>'; return; }
    const grid = document.createElement('div');
    grid.className = 'page-grid';
    items.slice(0, 50).forEach(alb => {
        const card = document.createElement('div');
        card.className = 'page-card';
        const img = getImage(alb);
        const artist = getAlbumArtists(alb);
        card.innerHTML = `
            <div class="card-img" style="background:${img !== APP_LOGO ? `url('${img}')` : 'linear-gradient(135deg,var(--secondary),#C026D3)'};background-size:cover;background-position:center;">
                ${img === APP_LOGO ? '<div class="fallback"><i class="fas fa-compact-disc"></i></div>' : ''}
            </div>
            <div class="name">${escapeHtml(alb.name)}</div>
            <div class="singer-tag">${escapeHtml(artist)}</div>
            <div class="sub">${alb.year || 'Album'}</div>
        `;
        card.onclick = async () => {
            showToast('Album: ' + alb.name);
            const d = await callApi('/api/albums', { id: alb.id });
            if (d && d.songs && d.songs.length) {
                recordSeen('albums', alb);
                showPlaylistDetail({ name: alb.name }, d.songs, artist);
                navigateTo('playlists');
            } else showToast('No songs found');
        };
        grid.appendChild(card);
    });
    c.appendChild(grid);
}

function removeFavorite(event, songId) {
    if (event) event.stopPropagation();
    let liked = Storage.getLiked();
    const songToRemove = liked.find(s => String(s.id) === String(songId));
    const title = songToRemove ? (songToRemove.name || songToRemove.title) : 'Song';
    liked = liked.filter(s => String(s.id) !== String(songId));
    Storage.set('liked', liked);
    loadFavorites();
    updateFavCount();
    updateLikeUI();
    renderRecentlyAdded();
    showToast(`Removed "${title}" from Favorites`);
}

let pendingDeleteAction = null;

function showConfirmDeleteModal(title, message, onConfirm) {
    pendingDeleteAction = onConfirm;
    const modal = document.getElementById('confirmDeleteModalOverlay');
    if (!modal) return;
    document.getElementById('confirmDeleteTitle').textContent = title || 'Confirm Deletion';
    document.getElementById('confirmDeleteMessage').textContent = message || 'Are you sure you want to delete this?';
    modal.classList.add('active');
}

function closeConfirmDeleteModal(event) {
    if (event && event.target !== event.currentTarget) return;
    const modal = document.getElementById('confirmDeleteModalOverlay');
    if (modal) modal.classList.remove('active');
    pendingDeleteAction = null;
}

function executeDeleteAction() {
    if (typeof pendingDeleteAction === 'function') {
        pendingDeleteAction();
    }
    closeConfirmDeleteModal();
}

function clearAllFavorites() {
    const liked = Storage.getLiked();
    if (!liked.length) return;
    showConfirmDeleteModal(
        'Clear All Favorites',
        'Are you sure you want to remove all favorite songs from your collection?',
        function() {
            Storage.set('liked', []);
            loadFavorites();
            updateFavCount();
            updateLikeUI();
            renderRecentlyAdded();
            showToast('Cleared all favorites');
        }
    );
}

function loadFavorites() {
    const c = document.getElementById('favoritesContent');
    const actionsHeader = document.getElementById('favHeaderActions');
    const liked = Storage.getLiked();

    if (actionsHeader) actionsHeader.style.display = liked.length ? 'block' : 'none';

    if (!liked.length) {
        c.innerHTML = '<div class="empty-state"><i class="fas fa-heart"></i><p>No favorites yet. Tap ♥ on any song.</p></div>';
        return;
    }

    const grid = document.createElement('div');
    grid.className = 'page-grid';
    liked.forEach((song, idx) => {
        const card = document.createElement('div');
        card.className = 'page-card';
        const img = getImage(song);
        const artist = getArtistName(song);
        const name = song.name || song.title || 'Untitled';

        card.innerHTML = `
            <button class="card-delete-btn" onclick="removeFavorite(event, '${escapeHtml(song.id)}')" title="Remove from Favorites">
                <i class="fas fa-trash-can"></i>
            </button>
            <div class="card-img" style="background:${img !== APP_LOGO ? `url('${img}')` : 'linear-gradient(135deg,var(--secondary),#C026D3)'};background-size:cover;background-position:center;">
                ${img === APP_LOGO ? '<div class="fallback"><i class="fas fa-music"></i></div>' : ''}
            </div>
            <div class="name">${escapeHtml(name)}</div>
            <div class="singer-tag">${escapeHtml(artist)}</div>
        `;
        card.onclick = () => startPlay(song, liked, idx);
        grid.appendChild(card);
    });
    c.innerHTML = '';
    c.appendChild(grid);
}

function updateFavCount() {
    const badge = document.getElementById('favCount');
    const n = Storage.getLiked().length;
    if (!badge) return;
    badge.textContent = n;
    badge.style.display = n > 0 ? 'inline-block' : 'none';
}

function loadLibrary() {
    const c = document.getElementById('libraryGrid');
    const likedN = Storage.getLiked().length;
    const plN = userPlaylists.length;
    const items = [
        { name: 'Playlists', icon: 'fa-list-music', color: '#8B5CF6', page: 'playlists', count: plN + ' playlists' },
        { name: 'Artists', icon: 'fa-microphone-lines', color: '#EC4899', page: 'artists', count: 'Trending now' },
        { name: 'Albums', icon: 'fa-compact-disc', color: '#3B82F6', page: 'albums', count: 'Fresh releases' },
        { name: 'Favorites', icon: 'fa-heart', color: '#F59E0B', page: 'favorites', count: likedN + ' songs' }
    ];
    c.innerHTML = '';
    items.forEach(it => {
        const card = document.createElement('div');
        card.className = 'page-card';
        card.innerHTML = `
            <div class="card-img" style="background:linear-gradient(135deg,${it.color},${it.color}bb);"><div class="fallback"><i class="fas ${it.icon}"></i></div></div>
            <div class="name"><i class="fas ${it.icon}" style="margin-right:8px;color:${it.color};"></i>${it.name}</div>
            <div class="sub">${it.count}</div>
        `;
        card.onclick = () => navigateTo(it.page);
        c.appendChild(card);
    });
}

async function loadExplore() {
    const grid = document.getElementById('exploreGenreGrid');
    grid.innerHTML = '';
    const genres = [
        { name: 'Bollywood', icon: 'fa-film', color: '#EF4444', q: 'bollywood songs' },
        { name: 'Pop', icon: 'fa-music', color: '#3B82F6', q: 'pop songs' },
        { name: 'Hip Hop', icon: 'fa-headphones', color: '#8B5CF6', q: 'hip hop rap' },
        { name: 'Romantic', icon: 'fa-heart', color: '#EC4899', q: 'romantic love songs' },
        { name: 'Punjabi', icon: 'fa-drum', color: '#F59E0B', q: 'punjabi songs' },
        { name: 'Electronic', icon: 'fa-bolt', color: '#06B6D4', q: 'electronic dance' },
        { name: 'Devotional', icon: 'fa-hands-praying', color: '#10B981', q: 'devotional bhajan' },
        { name: 'Lofi', icon: 'fa-moon', color: '#6366F1', q: 'chill lofi' },
        { name: 'Workout', icon: 'fa-dumbbell', color: '#F97316', q: 'workout motivation' },
        { name: 'Rock', icon: 'fa-guitar', color: '#DC2626', q: 'rock songs' },
        { name: 'Jazz', icon: 'fa-microphone-lines', color: '#7C3AED', q: 'jazz fusion' },
        { name: 'Folk', icon: 'fa-leaf', color: '#22C55E', q: 'folk music' }
    ];
    genres.forEach(g => {
        const card = document.createElement('div');
        card.className = 'explore-genre-card';
        card.style.setProperty('--gc', g.color + '40');
        card.innerHTML = `<div class="icon" style="color:${g.color}"><i class="fas ${g.icon}"></i></div><div class="name">${g.name}</div><div class="count">Explore →</div>`;
        card.onclick = async () => {
            showToast('Loading ' + g.name);
            const d = await callApi('/api/search/songs', { query: g.q, page: 0, limit: 20 });
            const songs = (d && d.results) || [];
            if (songs.length) {
                showPlaylistDetail({ name: g.name + ' Hits' }, songs, 'Various');
                navigateTo('playlists');
            } else showToast('No songs found');
        };
        grid.appendChild(card);
    });
}

// ─── SEARCH ENTRY POINTS (ONE SHARED DASHBOARD FIELD) ────────────
function handleSearch(val) { handleInterfaceSearch(val); }
function performSearch(query) { quickSearchQuery(query); }
function clearSearch() {
    const input = document.getElementById('searchInput');
    if (input) input.value = '';
    handleInterfaceSearch('', false);
}

// ─── FEATURED + QUICK PICKS (HOME) ──────────────────────────────
async function loadFeatured() {
    const grid = document.getElementById('featuredGrid');
    grid.innerHTML = '';
    const customFeatured = [
        { name: 'Baarish Aur Dance', subtitle: 'Monsoon Hits', songCount: '50 Songs', color: '#8B5CF6', icon: 'fa-cloud-rain', query: 'monsoon dance songs' },
        { name: 'Jhakaas Remakes', subtitle: 'Best Remixes', songCount: '40 Songs', color: '#EC4899', icon: 'fa-headphones', query: 'remix songs' },
        { name: 'VIRAL NATION', subtitle: 'Trending Now', songCount: '100 Songs', color: '#F59E0B', icon: 'fa-fire', query: 'viral trending songs' },
        { name: 'Baarish Aur Pyaar', subtitle: 'Rainy Day Romance', songCount: '60 Songs', color: '#3B82F6', icon: 'fa-umbrella', query: 'romantic rain songs' }
    ];
    customFeatured.forEach(pl => {
        const card = document.createElement('div');
        card.className = 'playlist-card';
        card.innerHTML = `
            <div class="card-image-wrapper">
                <div class="card-image" style="background:linear-gradient(135deg, ${pl.color}, ${pl.color}cc 60%, #1a1030);">
                    <i class="fas ${pl.icon}" style="font-size:52px;color:rgba(255,255,255,0.85);"></i>
                    <div class="play-overlay"><i class="fas fa-play"></i></div>
                </div>
            </div>
            <div class="card-content">
                <h3 class="card-title">${escapeHtml(pl.name)}</h3>
                <p class="card-songs">${pl.songCount} • ${pl.subtitle}</p>
            </div>
        `;
        card.onclick = async () => {
            showToast('Loading ' + pl.name);
            const sd = await callApi('/api/search/songs', { query: pl.query, page: 0, limit: 20 });
            const songs = (sd && sd.results) || [];
            if (songs.length) {
                showPlaylistDetail({ name: pl.name }, songs, pl.subtitle);
                navigateTo('playlists');
            } else showToast('No songs found');
        };
        grid.appendChild(card);
    });
}

function loadQuickPicks() {
    const grid = document.getElementById('quickGrid');
    grid.innerHTML = '';
    const picks = [
        { name: 'Top Trending', sub: 'What everyone is playing', icon: 'fa-arrow-trend-up', color: '#EF4444', q: 'trending songs 2024' },
        { name: 'Fresh Bollywood', sub: 'Latest Hindi drops', icon: 'fa-film', color: '#F59E0B', q: 'new hindi songs' },
        { name: 'Chill Vibes', sub: 'Relax & unwind', icon: 'fa-mug-hot', color: '#10B981', q: 'chill relaxing songs' },
        { name: 'Party Anthems', sub: 'Turn the volume up', icon: 'fa-champagne-glasses', color: '#EC4899', q: 'party anthem songs' },
        { name: 'Sad Hours', sub: 'For the feels', icon: 'fa-cloud-rain', color: '#6366F1', q: 'sad emotional songs' },
        { name: 'Golden Classics', sub: 'Old is gold', icon: 'fa-record-vinyl', color: '#8B5CF6', q: 'classic old songs' }
    ];
    picks.forEach(p => {
        const el = document.createElement('div');
        el.className = 'quick-pick';
        el.innerHTML = `
            <div class="qp-art" style="background:linear-gradient(135deg, ${p.color}, ${p.color}aa);color:#fff;"><i class="fas ${p.icon}"></i></div>
            <div class="qp-info"><div class="qp-name">${p.name}</div><div class="qp-sub">${p.sub}</div></div>
            <button class="qp-play" title="Play"><i class="fas fa-play"></i></button>
        `;
        el.onclick = async () => {
            showToast('Loading ' + p.name);
            const sd = await callApi('/api/search/songs', { query: p.q, page: 0, limit: 20 });
            const songs = (sd && sd.results) || [];
            if (songs.length) startPlay(songs[0], songs, 0);
            else showToast('No songs found');
        };
        grid.appendChild(el);
    });
}

// ─── LIKE ───────────────────────────────────────────────────────
function toggleLike() {
    if (!currentSong) { showToast('No song playing'); return; }
    const liked = Storage.getLiked();
    const idx = liked.findIndex(s => s.id === currentSong.id);
    if (idx > -1) { liked.splice(idx, 1); isLiked = false; showToast('Removed from Favorites'); }
    else { liked.unshift(currentSong); isLiked = true; showToast('♥ Added to Favorites'); }
    Storage.set('liked', liked);
    updateLikeUI();
    updateFavCount();
    renderRecentlyAdded();
}

function updateLikeUI() {
    const likeBtn = document.getElementById('likeBtn');
    const bottomLike = document.getElementById('bottomLike');
    if (likeBtn) { likeBtn.classList.toggle('liked', isLiked); likeBtn.style.color = isLiked ? 'var(--pink)' : 'var(--text-muted)'; }
    if (bottomLike) { bottomLike.classList.toggle('liked', isLiked); bottomLike.style.color = isLiked ? 'var(--pink)' : 'var(--text-muted)'; }
}

// ─── PLAYER CORE ────────────────────────────────────────────────
function decodeApiText(value) {
    const decoder = document.createElement('textarea');
    decoder.innerHTML = String(value || '');
    return decoder.value;
}

function updateMiniArtwork(img) {
    const thumb = document.getElementById('bottomThumb');
    thumb.innerHTML = '';
    const fallback = () => {
        if (thumb.querySelector('.artwork-fallback')) return;
        const icon = document.createElement('i');
        icon.className = 'fas fa-headphones artwork-fallback';
        thumb.prepend(icon);
    };
    if (img && img !== APP_LOGO) {
        const image = document.createElement('img');
        image.src = img;
        image.alt = 'Track artwork';
        image.onerror = () => { image.remove(); fallback(); };
        thumb.appendChild(image);
    } else fallback();
    const spectrum = document.createElement('div');
    spectrum.id = 'eqOverlay';
    spectrum.className = 'eq-overlay';
    spectrum.setAttribute('aria-hidden', 'true');
    spectrum.innerHTML = '<span></span><span></span><span></span><span></span>';
    thumb.appendChild(spectrum);
}

function replaceAudioPlayer() {
    const oldPlayer = audio;
    const player = document.createElement('audio');
    player.id = 'audioPlayer';
    player.preload = 'metadata';
    player.volume = oldPlayer.volume;
    player.loop = repeatEnabled;
    audio = player;
    oldPlayer.replaceWith(player);
    AudioEffects.disconnect();
    oldPlayer.pause();
    oldPlayer.removeAttribute('src');
    oldPlayer.load();
    bindAudioEvents(player);
    return player;
}

async function playStream(url, version) {
    const canProcess = AudioEffects.supported() && await AudioEffects.checkStream(url);
    if (version !== playbackRequestVersion) return false;
    if (!canProcess && AudioEffects.isConnectedTo(audio)) replaceAudioPlayer();
    audio.pause();
    if (canProcess) audio.crossOrigin = 'anonymous';
    else audio.removeAttribute('crossorigin');
    audio.src = url;
    if (canProcess) {
        if (!AudioEffects.connect(audio)) {
            // Even a partially-created MediaElementSource owns the original output.
            replaceAudioPlayer();
            audio.src = url;
            AudioEffects.unavailable('Audio processing could not start. Original audio playback is active.');
        }
    } else {
        AudioEffects.unavailable(AudioEffects.supported()
            ? 'This stream does not allow equalizer processing. Original playback is active.'
            : 'Web Audio is not supported in this browser. Standard playback is active.');
    }
    const player = audio;
    try {
        await player.play();
        if (version !== playbackRequestVersion || player !== audio) return false;
        setPlaying(true);
        return true;
    } catch (error) {
        if (version === playbackRequestVersion && player === audio) {
            setPlaying(false);
            showToast('Playback could not start — press play or try the next track.', 3000);
        }
        return false;
    }
}

async function startPlay(song, queue, index) {
    if (!song) return false;
    AudioEffects.unlock(); // Unlock synchronously within the user's click, before API work.
    const version = ++playbackRequestVersion;
    isLoadingSong = true;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    setPlaying(false);
    currentSong = song;
    currentQueue = queue || [song];
    currentIndex = index || 0;
    isLiked = isSongLiked(song);

    const img = getImage(song);
    const name = decodeApiText(song.name || song.title || '—');
    const artist = decodeApiText(getArtistName(song));
    const artContainer = document.getElementById('nowPlayingArt');
    artContainer.innerHTML = `
        <div class="disc-glow"></div>
        <div class="vinyl-record" id="vinylRecord" style="background:url('${escapeHtml(img)}') center/cover;border:none;">
            <div class="vinyl-ring r1"></div><div class="vinyl-ring r2"></div>
            <div class="vinyl-center"><i class="fas fa-play" id="vinylIcon"></i></div>
        </div>`;
    document.getElementById('nowPlayingTitle').textContent = name;
    document.getElementById('nowPlayingArtist').textContent = artist;
    document.getElementById('bottomSongName').textContent = name;
    document.getElementById('bottomArtist').textContent = artist;
    updateMiniArtwork(img);
    updateStreamQuality(song);
    document.getElementById('bottom-player').classList.add('visible');
    updateLikeUI();
    const recent = Storage.getRecent().filter(s => String(s.id) !== String(song.id));
    recent.unshift(song);
    Storage.set('recent', recent.slice(0, 50));
    refreshListeningHistory();
    if ('mediaSession' in navigator && window.MediaMetadata) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: name, artist,
            artwork: [{ src: img, sizes: '512x512' }] });
    }

    try {
        let url = getDownloadUrl(song);
        if (!url) {
            showToast('Fetching audio…', 3000);
            const data = await callApi('/api/songs', { id: song.id });
            if (version !== playbackRequestVersion) return false;
            const fullSong = Array.isArray(data) ? data[0] : data;
            if (fullSong) {
                currentSong = { ...song, ...fullSong };
                currentQueue[currentIndex] = currentSong;
                url = getDownloadUrl(currentSong);
                updateStreamQuality(currentSong);
            }
        }
        if (version !== playbackRequestVersion) return false;
        if (!url) { showToast('No audio available — try another track.'); return false; }
        const started = await playStream(url, version);
        if (started && version === playbackRequestVersion) showToast('🎵 Now Playing: ' + name, 2000);
        return started;
    } finally {
        if (version === playbackRequestVersion) isLoadingSong = false;
    }
}

function setPlaying(state) {
    isPlaying = state;
    const icon = state ? 'fa-pause' : 'fa-play';
    document.getElementById('playIcon').className = 'fas ' + icon;
    document.getElementById('bottomPlayIcon').className = 'fas ' + icon;
    const vinyl = document.getElementById('vinylIcon');
    if (vinyl) vinyl.className = 'fas ' + icon;
    // The hero Play Now action discovers a new track; player controls pause/resume.
    const record = document.getElementById('vinylRecord');
    if (record) record.classList.toggle('playing', state);
    const thumb = document.getElementById('bottomThumb');
    if (thumb) thumb.classList.toggle('playing', state);
    AudioEffects.playbackChanged(audio, state);
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = state ? 'playing' : 'paused';
}

function togglePlay() {
    AudioEffects.unlock();
    if (!currentSong) { playRandomSong(); return; }
    if (isLoadingSong) { showToast('Loading this track…'); return; }
    if (isPlaying && !audio.paused) audio.pause();
    else if (audio.getAttribute('src')) {
        audio.play().then(() => setPlaying(true)).catch(() => showToast('Playback error — try the next track'));
    } else startPlay(currentSong, currentQueue, currentIndex);
}

function nextTrack() {
    if (shuffleEnabled && currentQueue.length > 1) {
        let next;
        do { next = Math.floor(Math.random() * currentQueue.length); } while (next === currentIndex);
        currentIndex = next;
        startPlay(currentQueue[currentIndex], currentQueue, currentIndex);
        return;
    }
    if (!currentQueue.length) { playRandomSong(); return; }
    if (currentIndex < currentQueue.length - 1) {
        currentIndex++;
        startPlay(currentQueue[currentIndex], currentQueue, currentIndex);
    } else playRandomSong();
}

function prevTrack() {
    if (!currentQueue.length) return;
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    if (shuffleEnabled && currentQueue.length > 1) {
        let prev;
        do { prev = Math.floor(Math.random() * currentQueue.length); } while (prev === currentIndex);
        currentIndex = prev;
        startPlay(currentQueue[currentIndex], currentQueue, currentIndex);
        return;
    }
    if (currentIndex > 0) {
        currentIndex--;
        startPlay(currentQueue[currentIndex], currentQueue, currentIndex);
    } else startPlay(currentQueue[0], currentQueue, 0);
}

// Discover from a varied pool, not the first quick-pick or the current track.
const DISCOVERY_QUERIES = ['Hindi hits', 'Punjabi hits', 'Bollywood romantic', 'Arijit Singh',
    'Diljit Dosanjh', 'pop hits', 'indie Hindi', 'chill lofi'];
let discoveryPool = [];
let discoveryUpdatedAt = 0;
let discoveryQueryCursor = Math.floor(Math.random() * DISCOVERY_QUERIES.length);
let discoveryBusy = false;
let scopedPool = [];
let scopedPoolUpdatedAt = 0;

function shuffleSongs(songs) {
    const result = songs.slice();
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}
function setDiscoveryBusy(busy) {
    const button = document.getElementById('heroDiscoveryBtn');
    if (button) { button.disabled = busy; button.setAttribute('aria-busy', String(busy)); }
    document.getElementById('heroPlayIcon').className = busy ? 'fas fa-spinner fa-spin' : 'fas fa-play';
    document.getElementById('heroPlayText').textContent = busy ? 'Finding music…' : 'Play Now';
}
function freshDiscoveryCandidates(pool) {
    const candidatePool = Array.isArray(pool) ? pool : discoveryPool;
    const recentIds = new Set(Storage.getRecent().slice(0, 20).map(song => String(song.id)));
    const currentId = currentSong && String(currentSong.id);
    return candidatePool.filter(song => String(song.id) !== currentId && !recentIds.has(String(song.id)));
}
async function playRandomSong(scopedQueries) {
    if (discoveryBusy) return;
    AudioEffects.unlock();
    discoveryBusy = true;
    setDiscoveryBusy(true);
    const version = ++playbackRequestVersion;
    isLoadingSong = false; // Any previous, still-loading selection has been superseded.
    try {
        // A mood scope (hero Play Now) explores that mood's own pool instead.
        const scoped = Array.isArray(scopedQueries) && scopedQueries.length ? scopedQueries.map(String).slice(0, 2) : null;
        const pool = scoped ? scopedPool : discoveryPool;
        const poolUpdatedAt = scoped ? scopedPoolUpdatedAt : discoveryUpdatedAt;
        let candidates = freshDiscoveryCandidates(pool);
        if (!candidates.length || Date.now() - poolUpdatedAt > 5 * 60 * 1000) {
            const queries = scoped || [0, 1].map(() => DISCOVERY_QUERIES[discoveryQueryCursor++ % DISCOVERY_QUERIES.length]);
            // Fire every request up front so one slow endpoint cannot stall the others.
            const requests = queries.map(query => callApi('/api/search/songs', { query, page: 0, limit: scoped ? 30 : 25 }));
            if (!scoped) requests.unshift(callApi('/api/trending/songs', { page: 1, limit: 40 }));
            const results = await Promise.all(requests);
            if (version !== playbackRequestVersion) return;
            const unique = new Map(pool.map(song => [String(song.id), song]));
            results.forEach(data => {
                const songs = Array.isArray(data) ? data : (data && (data.results || data.songs)) || [];
                if (Array.isArray(songs)) songs.forEach(song => {
                    if (song && song.id) unique.set(String(song.id), song);
                });
            });
            const merged = Array.from(unique.values()).slice(-200);
            if (scoped) { scopedPool = merged; scopedPoolUpdatedAt = Date.now(); }
            else { discoveryPool = merged; discoveryUpdatedAt = Date.now(); }
            candidates = freshDiscoveryCandidates(scoped ? scopedPool : discoveryPool);
        }
        if (version !== playbackRequestVersion) return;
        // Repeat only after the available pool is exhausted; never replay the current song.
        if (!candidates.length) candidates = (scoped ? scopedPool : discoveryPool).filter(song => !currentSong || String(song.id) !== String(currentSong.id));
        if (!candidates.length) {
            showToast('Could not find a different track right now. Try a search.', 3000);
            return;
        }
        const queue = shuffleSongs(candidates).slice(0, 30);
        await startPlay(queue[0], queue, 0);
    } finally {
        discoveryBusy = false;
        setDiscoveryBusy(false);
    }
}

function toggleShuffle() {
    shuffleEnabled = !shuffleEnabled;
    document.getElementById('shuffleBtn').classList.toggle('active', shuffleEnabled);
    document.getElementById('bottomShuffle').classList.toggle('active', shuffleEnabled);
    showToast(shuffleEnabled ? '🔀 Shuffle On' : '🔀 Shuffle Off');
}
function toggleRepeat() {
    repeatEnabled = !repeatEnabled;
    audio.loop = repeatEnabled;
    document.getElementById('repeatBtn').classList.toggle('active', repeatEnabled);
    document.getElementById('bottomRepeat').classList.toggle('active', repeatEnabled);
    showToast(repeatEnabled ? '🔁 Repeat On' : '🔁 Repeat Off');
}
function setVolume(v) {
    v = parseInt(v);
    audio.volume = v / 100;
    Storage.set('volume', v / 100);
    document.getElementById('volumeFill').style.width = v + '%';
    document.getElementById('volumeSlider').value = v;
    if (v > 0 && isMuted) { isMuted = false; document.getElementById('volumeIcon').className = 'fas fa-volume-high'; }
}
function toggleMute() {
    const icon = document.getElementById('volumeIcon');
    if (isMuted) {
        isMuted = false;
        setVolume(lastVolume);
        icon.className = lastVolume == 0 ? 'fas fa-volume-xmark' : 'fas fa-volume-high';
    } else {
        isMuted = true;
        lastVolume = document.getElementById('volumeSlider').value;
        audio.volume = 0;
        document.getElementById('volumeFill').style.width = '0%';
        icon.className = 'fas fa-volume-xmark';
    }
}
function seekProgress(e) {
    if (!audio.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    audio.currentTime = p * audio.duration;
}
function seekBottomProgress(e) {
    if (!audio.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    audio.currentTime = p * audio.duration;
}

// ─── AUDIO EVENTS ───────────────────────────────────────────────
function bindAudioEvents(player) {
    player.addEventListener('timeupdate', () => {
        if (player !== audio || !audio.duration) return;
        const progress = (audio.currentTime / audio.duration) * 100;
        document.getElementById('progressFill').style.width = progress + '%';
        document.getElementById('bottomProgressFill').style.width = progress + '%';
        document.getElementById('currentTime').textContent = formatTime(audio.currentTime);
        document.getElementById('totalTime').textContent = formatTime(audio.duration);
        document.getElementById('bottomCurrentTime').textContent = formatTime(audio.currentTime);
        document.getElementById('bottomTotalTime').textContent = formatTime(audio.duration);
    });
    player.addEventListener('ended', () => {
        if (player !== audio) return;
        if (!repeatEnabled) {
            if (currentQueue.length > 1) nextTrack();
            else setPlaying(false);
        } else audio.play().catch(() => setPlaying(false));
    });
    player.addEventListener('play', () => { if (player === audio) setPlaying(true); });
    player.addEventListener('pause', () => { if (player === audio) setPlaying(false); });
    player.addEventListener('error', () => {
        if (player !== audio || !currentSong) return;
        if (player.crossOrigin === 'anonymous' && player.getAttribute('src')) {
            const url = player.src;
            const replacement = replaceAudioPlayer();
            AudioEffects.unavailable('This stream rejected audio processing. Original playback is active.');
            replacement.src = url;
            replacement.play().catch(() => {
                if (replacement === audio) { setPlaying(false); showToast('Stream error — try next track'); }
            });
        } else { setPlaying(false); showToast('Stream error — try next track'); }
    });
}
function setupAudio() {
    bindAudioEvents(audio);
    const saved = Number(Storage.get('volume') ?? 0.8);
    const volume = Number.isFinite(saved) ? Math.max(0, Math.min(1, saved)) : 0.8;
    audio.volume = volume;
    document.getElementById('volumeSlider').value = volume * 100;
    document.getElementById('volumeFill').style.width = volume * 100 + '%';
}

// ─── MEDIA SESSION CONTROLS ─────────────────────────────────────
function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    try {
        navigator.mediaSession.setActionHandler('play', () => { if (!isPlaying) togglePlay(); });
        navigator.mediaSession.setActionHandler('pause', () => { if (isPlaying) togglePlay(); });
        navigator.mediaSession.setActionHandler('nexttrack', () => nextTrack());
        navigator.mediaSession.setActionHandler('previoustrack', () => prevTrack());
    } catch (e) { /* older browsers */ }
}

// ─── STARS ──────────────────────────────────────────────────────
function generateStars() {
    const container = document.getElementById('starsBg');
    if (!container) return; // v3 console uses a photographic backdrop instead.
    for (let i = 0; i < 90; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        star.style.left = Math.random() * 100 + '%';
        star.style.top = Math.random() * 100 + '%';
        star.style.animationDelay = Math.random() * 3 + 's';
        star.style.animationDuration = (Math.random() * 2 + 2) + 's';
        const size = Math.random() * 2 + 1;
        star.style.width = size + 'px';
        star.style.height = size + 'px';
        container.appendChild(star);
    }
}

// ─── KEYBOARD SHORTCUTS ─────────────────────────────────────────
function setupKeyboard() {
    document.addEventListener('keydown', (e) => {
        // Keep keyboard focus inside a dialog without stealing slider arrow keys.
        const activeDialog = document.querySelector('.modal-overlay.active');
        if (e.key === 'Tab' && activeDialog) {
            const focusable = Array.from(activeDialog.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]'))
                .filter(el => el.getClientRects().length && getComputedStyle(el).visibility === 'visible');
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (first && (e.shiftKey && document.activeElement === first || !e.shiftKey && document.activeElement === last)) {
                e.preventDefault();
                (e.shiftKey ? last : first).focus();
            }
            return;
        }
        // Escape must also work while typing; colour buttons keep their native keys.
        if (e.key === 'Escape') {
            const activeModal = document.querySelector('.modal-overlay.active');
            if (activeModal) {
                const closers = {
                    createPlaylistModalOverlay: closeCreatePlaylistModal,
                    addToPlaylistModalOverlay: closeAddToPlaylistModal,
                    confirmDeleteModalOverlay: closeConfirmDeleteModal,
                    syncModalOverlay: closeSyncModal,
                    equalizerModalOverlay: () => AudioEffects.close()
                };
                if (closers[activeModal.id]) closers[activeModal.id]();
            } else if (document.getElementById('dashboardSearchPanel').classList.contains('active')) {
                closeSearchInterface();
            } else {
                clearSearch();
            }
            e.preventDefault();
            return;
        }
        // Ctrl/Cmd+K focuses the dashboard search from anywhere, even inside a field.
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') {
            e.preventDefault();
            handleShortcutFocusSearch();
            return;
        }
        if (e.target.closest('input, textarea, select') || e.target.isContentEditable) return;
        if (document.querySelector('.modal-overlay.active')) return;
        if (e.target.closest('button') && (e.code === 'Space' || e.code === 'Enter')) return;
        switch (e.code) {
            case 'Space': e.preventDefault(); togglePlay(); break;
            case 'ArrowRight': e.preventDefault(); nextTrack(); break;
            case 'ArrowLeft': e.preventDefault(); prevTrack(); break;
            case 'ArrowUp': e.preventDefault(); {
                const s = document.getElementById('volumeSlider');
                setVolume(Math.min(100, parseInt(s.value) + 10)); break;
            }
            case 'ArrowDown': e.preventDefault(); {
                const s = document.getElementById('volumeSlider');
                setVolume(Math.max(0, parseInt(s.value) - 10)); break;
            }
            case 'KeyM': toggleMute(); break;
            case 'KeyS':
            case 'Slash': e.preventDefault(); handleShortcutFocusSearch(); break;
        }
    });
}
function handleShortcutFocusSearch() {
    openSearchInterface();
    const input = document.getElementById('searchInput');
    if (input) { input.focus(); input.select(); }
}

// ─── VOICE SEARCH ──────────────────────────────────────────────
let speechRecognition = null;
let isVoiceSearching = false;

function updateVoiceSearchFeedback(listening) {
    const hud = document.getElementById('voiceSearchHUD');
    if (hud) hud.style.display = listening ? 'flex' : 'none';
    const button = document.getElementById('voiceSearchBtn');
    if (button) button.classList.toggle('listening', listening);
}

function toggleVoiceSearch() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        showToast('🎙️ Voice search is not supported in this browser. Try Chrome or Edge.');
        return;
    }
    if (speechRecognition) {
        stopVoiceSearch();
        return;
    }

    try {
        const recognition = new SpeechRecognition();
        speechRecognition = recognition;
        recognition.lang = 'en-US';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        recognition.onstart = function() {
            if (speechRecognition !== recognition) return;
            isVoiceSearching = true;
            updateVoiceSearchFeedback(true);
        };
        recognition.onresult = function(event) {
            if (speechRecognition !== recognition) return;
            const transcript = event.results[0][0].transcript;
            const input = document.getElementById('searchInput');
            if (input) input.value = transcript;
            openSearchInterface();
            quickSearchQuery(transcript);
            showToast(`🔍 Searching for: "${transcript}"`, 2500);
            stopVoiceSearch();
        };
        recognition.onerror = function(event) {
            if (speechRecognition !== recognition) return;
            console.warn('Speech recognition error:', event.error);
            if (event.error === 'not-allowed' || event.error === 'permission-denied') {
                showToast('🎙️ Allow microphone access in your browser settings to use voice search.', 3500);
            } else if (event.error === 'no-speech') {
                showToast('🎙️ No speech detected. Try speaking closer to microphone.');
            } else {
                showToast('🎙️ Voice search error: ' + event.error);
            }
            stopVoiceSearch();
        };
        recognition.onend = function() {
            if (speechRecognition === recognition) stopVoiceSearch();
        };
        recognition.start();
    } catch (e) {
        console.error('Speech recognition exception:', e);
        showToast('🎙️ Voice search error');
        stopVoiceSearch();
    }
}

function stopVoiceSearch() {
    const recognition = speechRecognition;
    speechRecognition = null;
    isVoiceSearching = false;
    if (recognition) {
        try { recognition.abort(); } catch(e) {}
    }
    updateVoiceSearchFeedback(false);
}

// ─── CROSS-BROWSER SYNC & DATA MANAGEMENT ────────────────────────
function openSyncModal() {
    const modal = document.getElementById('syncModalOverlay');
    if (!modal) return;
    modal.classList.add('active');

    const exportData = {
        liked: Storage.getLiked(),
        playlists: userPlaylists,
        version: '2.0',
        timestamp: Date.now()
    };
    try {
        const jsonStr = JSON.stringify(exportData);
        const code = btoa(encodeURIComponent(jsonStr));
        const input = document.getElementById('exportSyncCodeInput');
        if (input) input.value = code;
    } catch (e) {
        console.error('Error generating sync code:', e);
    }
}

function closeSyncModal(event) {
    if (event && event.target !== event.currentTarget) return;
    const modal = document.getElementById('syncModalOverlay');
    if (modal) modal.classList.remove('active');
}

function switchSyncTab(tab) {
    const tabCode = document.getElementById('tab-sync-code');
    const tabFile = document.getElementById('tab-sync-file');
    const btnCode = document.getElementById('tabBtnCode');
    const btnFile = document.getElementById('tabBtnFile');

    if (tab === 'code') {
        if (tabCode) tabCode.classList.add('active');
        if (tabFile) tabFile.classList.remove('active');
        if (btnCode) btnCode.classList.add('active');
        if (btnFile) btnFile.classList.remove('active');
    } else {
        if (tabCode) tabCode.classList.remove('active');
        if (tabFile) tabFile.classList.add('active');
        if (btnCode) btnCode.classList.remove('active');
        if (btnFile) btnFile.classList.add('active');
    }
}

function copySyncCode() {
    const input = document.getElementById('exportSyncCodeInput');
    if (!input || !input.value) return;
    navigator.clipboard.writeText(input.value).then(() => {
        showToast('📋 Sync Code copied to clipboard!');
    }).catch(() => {
        input.select();
        document.execCommand('copy');
        showToast('📋 Sync Code copied!');
    });
}

function copySyncLink() {
    const input = document.getElementById('exportSyncCodeInput');
    if (!input || !input.value) return;
    const url = window.location.origin + window.location.pathname + '?sync=' + encodeURIComponent(input.value);
    navigator.clipboard.writeText(url).then(() => {
        showToast('🔗 Cross-Browser Sync Link copied!');
    }).catch(() => {
        showToast('🔗 Sync Link created!');
    });
}

function applySyncCode() {
    const input = document.getElementById('importSyncCodeInput');
    if (!input || !input.value.trim()) {
        showToast('Please paste a Sync Code');
        return;
    }
    try {
        const raw = decodeURIComponent(atob(input.value.trim()));
        const data = JSON.parse(raw);
        if (data && (data.liked || data.playlists)) {
            if (Array.isArray(data.liked)) Storage.set('liked', data.liked);
            if (Array.isArray(data.playlists)) {
                userPlaylists = data.playlists;
                saveUserPlaylists();
            }
            loadFavorites();
            updateFavCount();
            loadUserPlaylists();
            loadLibrary();
            showToast('✅ Playlists & Favorites successfully synced!');
            closeSyncModal();
        } else {
            showToast('Invalid Sync Code format');
        }
    } catch (e) {
        console.error('Error importing sync code:', e);
        showToast('Invalid or corrupted Sync Code');
    }
}

function exportDataFile() {
    const data = {
        liked: Storage.getLiked(),
        playlists: userPlaylists,
        appName: 'ECCOverse Pro',
        exportedAt: new Date().toISOString()
    };
    const jsonBlob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(jsonBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eccoverse_backup_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('📥 Backup file downloaded!');
}

function importDataFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (data && (data.liked || data.playlists)) {
                if (Array.isArray(data.liked)) Storage.set('liked', data.liked);
                if (Array.isArray(data.playlists)) {
                    userPlaylists = data.playlists;
                    saveUserPlaylists();
                }
                loadFavorites();
                updateFavCount();
                loadUserPlaylists();
                loadLibrary();
                showToast('✅ Playlists & Favorites restored from backup!');
                closeSyncModal();
            } else {
                showToast('Invalid backup file structure');
            }
        } catch (err) {
            showToast('Error reading JSON file');
        }
    };
    reader.readAsText(file);
}

function checkUrlSync() {
    const params = new URLSearchParams(window.location.search);
    const syncCode = params.get('sync');
    if (syncCode) {
        try {
            const raw = decodeURIComponent(atob(syncCode));
            const data = JSON.parse(raw);
            if (data && (data.liked || data.playlists)) {
                if (Array.isArray(data.liked)) Storage.set('liked', data.liked);
                if (Array.isArray(data.playlists)) {
                    userPlaylists = data.playlists;
                    saveUserPlaylists();
                }
                showToast('✅ Synced playlists & favorites from URL link!', 3500);
                window.history.replaceState({}, document.title, window.location.pathname);
            }
        } catch (e) {
            console.warn('URL sync failed:', e);
        }
    }
}

// ─── SEARCH WITHIN THE DASHBOARD ────────────────────────────────
let searchInterfaceTimeout = null;
let searchInterfaceVersion = 0;

function openSearchInterface() {
    const panel = document.getElementById('dashboardSearchPanel');
    if (!panel) return;
    const alreadyOpen = panel.classList.contains('active');
    panel.classList.add('active');
    const input = document.getElementById('searchInput');
    if (input) input.setAttribute('aria-expanded', 'true');
    const bar = document.querySelector('.topbar .search-bar');
    if (bar) bar.classList.add('search-active');
    if (!alreadyOpen) {
        renderRecentSearches();
        switchSearchResTab('all');
        handleInterfaceSearch(input ? input.value : '', false);
        document.getElementById('contentArea').scrollTop = 0;
    }
}
function closeSearchInterface() {
    clearTimeout(searchInterfaceTimeout);
    searchInterfaceVersion++;
    stopVoiceSearch();
    const panel = document.getElementById('dashboardSearchPanel');
    if (panel) panel.classList.remove('active');
    const input = document.getElementById('searchInput');
    if (input) { input.value = ''; input.setAttribute('aria-expanded', 'false'); }
    document.getElementById('searchClear').classList.remove('visible');
    const bar = document.querySelector('.topbar .search-bar');
    if (bar) bar.classList.remove('search-active');
    if (input === document.activeElement || panel && panel.contains(document.activeElement)) document.activeElement.blur();
}
function handleInterfaceSearch(val, open = true) {
    const panel = document.getElementById('dashboardSearchPanel');
    if (open && panel && !panel.classList.contains('active')) openSearchInterface();
    clearTimeout(searchInterfaceTimeout);
    const version = ++searchInterfaceVersion;
    const value = String(val || '');
    const query = value.trim();
    const input = document.getElementById('searchInput');
    if (input && input.value !== value) input.value = value;
    document.getElementById('searchClear').classList.toggle('visible', Boolean(query));
    document.getElementById('dashboardSearchTitle').textContent = query ? `Results for “${query}”` : 'Find your next favourite';
    if (!query) {
        document.getElementById('searchSuggestionsView').style.display = 'block';
        document.getElementById('interfaceSearchResults').style.display = 'none';
        switchSearchResTab('all');
        return;
    }
    searchInterfaceTimeout = setTimeout(() => performInterfaceSearch(query, version), 350);
}
function quickSearchQuery(query) {
    openSearchInterface();
    handleInterfaceSearch(query);
}
function clearInterfaceSearch() { clearSearch(); }

function saveRecentSearch(q) {
    if (!q || !q.trim()) return;
    let recents = Storage.get('recent_searches') || [];
    recents = recents.filter(s => s.toLowerCase() !== q.toLowerCase());
    recents.unshift(q);
    if (recents.length > 8) recents = recents.slice(0, 8);
    Storage.set('recent_searches', recents);
    renderRecentSearches();
}

function renderRecentSearches() {
    const recents = Storage.get('recent_searches') || [];
    const sec = document.getElementById('recentSearchesSection');
    const container = document.getElementById('recentSearchesList');
    if (!sec || !container) return;

    if (!recents.length) {
        sec.style.display = 'none';
        return;
    }

    container.innerHTML = '';
    recents.forEach(term => {
        const btn = document.createElement('button');
        btn.className = 'sug-tag';
        btn.innerHTML = `<i class="fas fa-clock" style="font-size:11px; opacity:0.7;"></i> ${escapeHtml(term)}`;
        btn.onclick = () => quickSearchQuery(term);
        container.appendChild(btn);
    });
    sec.style.display = 'block';
}

function clearRecentSearches() {
    Storage.set('recent_searches', []);
    renderRecentSearches();
}

async function performInterfaceSearch(query, version = ++searchInterfaceVersion) {
    if (version !== searchInterfaceVersion) return;
    saveRecentSearch(query);
    document.getElementById('searchSuggestionsView').style.display = 'none';
    document.getElementById('interfaceSearchResults').style.display = 'block';

    const songsContainer = document.getElementById('searchResSongsList');
    const albumsContainer = document.getElementById('searchResAlbumsGrid');
    songsContainer.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Searching tracks...</p></div>';
    albumsContainer.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><i class="fas fa-spinner fa-spin"></i><p>Searching albums...</p></div>';

    const showSearchError = () => {
        if (version !== searchInterfaceVersion) return;
        songsContainer.innerHTML = '<div class="empty-state"><i class="fas fa-circle-exclamation"></i><p>Could not load songs. Please try again.</p></div>';
        albumsContainer.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><i class="fas fa-circle-exclamation"></i><p>Could not load albums. Please try again.</p></div>';
    };

    try {
        const data = await callApi('/api/search', { query, page: 0, limit: 30 });
        if (version !== searchInterfaceVersion) return;
        let songs = (data && data.songs && data.songs.results) || [];
        const albums = (data && data.albums && data.albums.results) || [];
        let songData = null;
        if (!songs.length) {
            songData = await callApi('/api/search/songs', { query, page: 0, limit: 30 });
            if (version !== searchInterfaceVersion) return;
            songs = (songData && songData.results) || [];
        }
        if (!data && !songData) {
            showSearchError();
            return;
        }
        renderSearchSongs(songs);
        renderSearchAlbums(albums);
    } catch (e) {
        console.error('Interface search error:', e);
        showSearchError();
    }
}

function renderSearchSongs(songs) {
    const container = document.getElementById('searchResSongsList');
    if (!container) return;
    container.innerHTML = '';

    if (!songs || !songs.length) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-music"></i><p>No songs found</p></div>';
        return;
    }

    songs.slice(0, 15).forEach((song, i) => {
        const div = document.createElement('div');
        div.className = 'song-list-item';
        const img = getImage(song);
        const name = decodeApiText(song.name || song.title || 'Unknown');
        const artist = getArtistName(song);
        div.innerHTML = `
            <span class="index">${i + 1}</span>
            <div class="thumb">${img !== APP_LOGO ? `<img src="${img}" alt="${escapeHtml(name)}" loading="lazy">` : '<i class="fas fa-music"></i>'}</div>
            <div class="info"><div class="name">${escapeHtml(name)}</div><div class="artist">${escapeHtml(artist)}</div></div>
            ${durationMarkup(song)}
            <button class="play-btn" title="Play"><i class="fas fa-play"></i></button>
            <button class="song-remove-btn" title="Add to Playlist" style="color:var(--primary);">
                <i class="fas fa-folder-plus"></i>
            </button>
        `;
        div.onclick = (e) => {
            if (e.target.closest('.song-remove-btn')) return;
            startPlay(song, songs, i);
        };
        div.querySelector('.song-remove-btn').onclick = (event) => {
            event.stopPropagation();
            openAddToPlaylistModal(song);
        };
        container.appendChild(div);
    });
}

function renderSearchAlbums(albums) {
    const container = document.getElementById('searchResAlbumsGrid');
    if (!container) return;
    container.innerHTML = '';

    if (!albums || !albums.length) {
        container.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;"><i class="fas fa-compact-disc"></i><p>No albums found</p></div>';
        return;
    }

    albums.slice(0, 8).forEach(alb => {
        const card = document.createElement('div');
        card.className = 'page-card';
        const img = getImage(alb);
        const name = decodeApiText(alb.name || alb.title || 'Untitled album');
        const artist = getAlbumArtists(alb);
        card.innerHTML = `
            <div class="card-img" style="background:${img !== APP_LOGO ? `url('${img}')` : 'linear-gradient(135deg,var(--secondary),#C026D3)'};background-size:cover;background-position:center;">
                ${img === APP_LOGO ? '<div class="fallback"><i class="fas fa-compact-disc"></i></div>' : ''}
            </div>
            <div class="name">${escapeHtml(name)}</div>
            <div class="singer-tag">${escapeHtml(artist)}</div>
            <div class="sub">${alb.year || 'Album'}</div>
        `;
        card.onclick = async () => {
            showToast('Loading ' + name);
            const d = await callApi('/api/albums', { id: alb.id });
            if (d && d.songs && d.songs.length) {
                closeSearchInterface();
                recordSeen('albums', alb);
                showPlaylistDetail({ name }, d.songs, artist);
                navigateTo('playlists');
            } else showToast('No songs found');
        };
        container.appendChild(card);
    });
}

function switchSearchResTab(tab) {
    if (!['all', 'songs', 'albums'].includes(tab)) tab = 'all';
    const layout = document.getElementById('searchResultsLayout');
    if (layout) layout.dataset.tab = tab;
    const activeId = 'tabRes' + tab.charAt(0).toUpperCase() + tab.slice(1);
    document.querySelectorAll('.search-res-tabs .res-tab').forEach(btn => {
        const active = btn.id === activeId;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', String(active));
    });
    const sections = { songs: 'searchResSongsSection', albums: 'searchResAlbumsSection' };
    Object.entries(sections).forEach(([category, id]) => {
        const section = document.getElementById(id);
        if (section) section.style.display = tab === 'all' || tab === category ? 'block' : 'none';
    });
}

// ─── INIT ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
    generateStars();
    setupAudio();
    AudioEffects.init();
    setupMediaSession();
    setupKeyboard();
    loadFeatured();
    loadQuickPicks();
    loadLibrary();
    initConsolePanels();
    loadUserPlaylists();
    updateFavCount();
    checkUrlSync();
    console.log('%c🎵 ECCOverse Pro v2.0', 'color:#A78BFA;font-weight:bold;font-size:14px', '— no login required, everything runs locally.');
});

/* ══════════════════════════════════════════════════════════════
   V3 CONSOLE PANELS — hero moods, history shelf, rail cards
   Everything here reuses the existing API, storage and player.
   ══════════════════════════════════════════════════════════════ */
const HERO_VIBES = [
    { line1: 'Late Night', line2: 'Vibes', eyebrow: 'Good music · Better mood',
      sub: 'For the overthinkers, dreamers and night owls.', query: 'late night songs',
      img: 'assets/hero-night.jpg', photo: '80% 26%', color: '#C7C3FB' },
    { line1: 'Monsoon', line2: 'Romance', eyebrow: 'Rainy windows · Soft hearts',
      sub: 'Melodic love songs for wet streets and long drives.', query: 'romantic rain songs',
      img: 'assets/hero-rain.jpg', photo: '76% 30%', color: '#9fd0ff' },
    { line1: 'Party', line2: 'Nation', eyebrow: 'Loud speakers · Full floor',
      sub: 'Anthems that keep the room moving until closing time.', query: 'party anthem songs',
      img: 'assets/hero-party.jpg', photo: '74% 24%', color: '#f5a0c8' },
    { line1: 'Focus', line2: 'Flow', eyebrow: 'Deep work · Gentle beats',
      sub: 'Low-key instrumentals for heads-down hours.', query: 'chill lofi',
      img: 'assets/hero-focus.jpg', photo: '78% 34%', color: '#a7e8d0' }
];
let heroVibeIndex = 0;
let heroRotateTimer = null;
let heroFrameTimer = null;
let heroPaused = false;

function renderHeroDots() {
    const wrap = document.getElementById('heroDots');
    if (!wrap) return;
    wrap.innerHTML = '';
    HERO_VIBES.forEach((vibe, index) => {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'hero-dot' + (index === heroVibeIndex ? ' active' : '');
        dot.setAttribute('role', 'tab');
        dot.setAttribute('aria-selected', String(index === heroVibeIndex));
        dot.title = vibe.line1 + ' ' + vibe.line2;
        dot.setAttribute('aria-label', vibe.line1 + ' ' + vibe.line2);
        dot.onclick = () => setHeroVibe(index);
        wrap.appendChild(dot);
    });
}
function setHeroArtwork(src, photo) {
    // Every mood carries its own artwork; the CSS night scene behind it covers
    // a missing file, so a bad path degrades instead of turning the hero black.
    const root = document.documentElement;
    // Absolute URL: the variable is substituted into a rule inside css/style.css,
    // where a relative path would resolve against css/ and 404.
    const value = `url("${new URL(src, document.baseURI).href}")`;
    if (root.dataset.heroArt === src) return;
    root.dataset.heroArt = src;
    const apply = () => root.style.setProperty('--hero-photo', value);
    if (!root.style.getPropertyValue('--hero-photo')) { apply(); return; }
    // Decode the next mood's artwork first and only then swap, so the picture
    // never dips to the empty layer mid-transition (a dip reads as a flash).
    const probe = new Image();
    probe.decoding = 'async';
    const settle = () => apply();
    if (probe.decode) {
        probe.src = src;
        probe.decode().then(settle, settle);
    } else {
        probe.onload = probe.onerror = settle;
        probe.src = src;
    }
}
function preloadHeroArtwork() {
    HERO_VIBES.forEach(vibe => { const img = new Image(); img.decoding = 'async'; img.src = vibe.img; });
}
function setHeroVibe(index) {
    heroVibeIndex = ((index % HERO_VIBES.length) + HERO_VIBES.length) % HERO_VIBES.length;
    const vibe = HERO_VIBES[heroVibeIndex];
    const title = document.getElementById('heroTitle');
    if (title) title.innerHTML = escapeHtml(vibe.line1) + '<span>' + escapeHtml(vibe.line2) + '</span>';
    const eyebrow = document.getElementById('heroEyebrow');
    if (eyebrow) eyebrow.textContent = vibe.eyebrow;
    const sub = document.getElementById('heroSubtitle');
    if (sub) sub.textContent = vibe.sub;
    const photo = document.getElementById('heroPhoto');
    if (photo) {
        // Narrow screens crop the artwork harder, so bias to the face instead of the scene.
        const [x, y] = vibe.photo.split(' ');
        photo.style.backgroundPosition = (window.innerWidth <= 520 ? '92%' : x) + ' ' + y;
        setHeroArtwork(vibe.img, photo);
    }
    const script = document.querySelector('.hero-script');
    if (script) script.style.color = vibe.color;
    document.querySelectorAll('.hero-dot').forEach((dot, i) => {
        const active = i === heroVibeIndex;
        dot.classList.toggle('active', active);
        dot.setAttribute('aria-selected', String(active));
    });
}
function startHeroRotation() {
    const section = document.getElementById('heroSection');
    if (section) {
        section.addEventListener('mouseenter', () => { heroPaused = true; });
        section.addEventListener('mouseleave', () => { heroPaused = false; });
        section.addEventListener('focusin', () => { heroPaused = true; });
        section.addEventListener('focusout', () => { heroPaused = false; });
    }
    window.addEventListener('resize', () => {
        clearTimeout(heroFrameTimer);
        heroFrameTimer = setTimeout(() => setHeroVibe(heroVibeIndex), 150);
    });
    if (heroRotateTimer) return;
    heroRotateTimer = setInterval(() => {
        if (heroPaused || document.hidden || document.querySelector('.modal-overlay.active')) return;
        setHeroVibe(heroVibeIndex + 1);
    }, 8000);
}
function playHeroVibe() {
    playRandomSong([HERO_VIBES[heroVibeIndex].query]);
}
async function saveVibePlaylist() {
    const vibe = HERO_VIBES[heroVibeIndex];
    const name = vibe.line1 + ' ' + vibe.line2;
    showToast('Saving "' + name + '"…', 2500);
    const data = await callApi('/api/search/songs', { query: vibe.query, page: 0, limit: 20 });
    const songs = (data && data.results) || [];
    if (!songs.length) { showToast('No songs found for this mood right now'); return; }
    const existing = userPlaylists.find(pl => pl.name === name);
    const playlist = existing || { id: 'vibe_' + heroVibeIndex, name, color: PLAYLIST_THEMES.purple.color, songs: [] };
    const known = new Set((playlist.songs || []).map(song => String(song.id)));
    playlist.songs = (playlist.songs || []).concat(songs.filter(song => song && song.id && !known.has(String(song.id)))).slice(0, 60);
    if (!existing) userPlaylists.push(playlist);
    saveUserPlaylists();
    navigateTo('playlists');
    showPlaylistDetail(playlist, playlist.songs, 'Saved from ' + vibe.eyebrow, true);
    showToast('✅ Saved ' + playlist.songs.length + ' songs to "' + name + '"', 2400);
}

/* Recent listening + collections ------------------------------------------------ */
function recordSeen(kind, item) {
    if (!item || !item.id) return;
    const key = kind === 'albums' ? 'seen_albums' : 'seen_artists';
    const list = Storage.get(key) || [];
    const entry = {
        id: String(item.id),
        name: decodeApiText(item.name || item.title || 'Untitled'),
        artist: decodeApiText(kind === 'albums' ? getAlbumArtists(item) : (item.subtitle || 'Artist')),
        image: (item.image || []),
        year: item.year || (kind === 'albums' ? 'Album' : 'Artist')
    };
    const next = [entry].concat(list.filter(seen => seen.id !== entry.id)).slice(0, 12);
    Storage.set(key, next);
    renderHomeCollections();
}
function tileArtStyle(item, index) {
    const img = item && item.image && item.image.length ? getImage(item) : '';
    if (img && img !== APP_LOGO) return ` style="background-image:url('${escapeHtml(img)}')"`;
    const palette = ['#8B5CF6', '#06B6D4', '#EC4899', '#F59E0B', '#10B981'];
    const color = (item && item.color) || palette[(index || 0) % palette.length];
    return ` style="background:${item && item.color ? getPlaylistCoverGradient(item.color) : `linear-gradient(135deg, ${color}, ${color}99 60%, #14161d)`}"`;
}
function tileMarkup(item, index, options) {
    const opts = options || {};
    const icon = opts.icon || 'fa-music';
    const artwork = item && item.image && item.image.length ? getImage(item) : '';
    // Real cover art replaces the placeholder glyph, like the reference tiles.
    const hasArt = Boolean(artwork) && artwork !== APP_LOGO;
    return `<div class="tile-art"${tileArtStyle(item, index)}${opts.round ? ' data-round="1"' : ''}>
            ${hasArt ? '' : `<i class="fas ${icon} tile-icon" aria-hidden="true"></i>`}
            <button class="tile-play" tabindex="-1" aria-hidden="true"><i class="fas fa-play"></i></button>
        </div>
        <div class="tile-title">${escapeHtml(item.title || 'Untitled')}</div>
        <div class="tile-sub">${escapeHtml(item.subtitle || '')}</div>`;
}
function renderRecentlyPlayed() {
    const row = document.getElementById('recentlyPlayedRow');
    if (!row) return;
    const recent = Storage.getRecent().slice(0, 8);
    if (!recent.length) {
        row.innerHTML = '<div class="shelf-empty">Nothing played yet — hit <strong>Play Now</strong> and your history lands here.</div>';
        return;
    }
    row.innerHTML = '';
    recent.forEach((song, index) => {
        const tile = document.createElement('div');
        tile.className = 'recent-tile';
        tile.tabIndex = 0;
        tile.setAttribute('role', 'button');
        const name = decodeApiText(song.name || song.title || 'Unknown');
        tile.innerHTML = tileMarkup({ title: name, subtitle: decodeApiText(getArtistName(song)), image: song.image, color: null }, index);
        tile.title = 'Play ' + name;
        const play = () => startPlay(song, recent, index);
        tile.onclick = play;
        tile.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); play(); } };
        row.appendChild(tile);
    });
}
function renderSidebarRecents() {
    const list = document.getElementById('sidebarRecentList');
    if (!list) return;
    const recent = Storage.getRecent().slice(0, 4);
    if (!recent.length) { list.innerHTML = '<div class="sidebar-recent-empty">Your next plays show up here.</div>'; return; }
    list.innerHTML = '';
    recent.forEach((song, index) => {
        const row = document.createElement('div');
        row.className = 'sidebar-recent-item';
        const img = getImage(song);
        const art = img && img !== APP_LOGO ? `background-image:url('${escapeHtml(img)}')` : 'background:linear-gradient(135deg,#8B5CF6,#14161d)';
        row.innerHTML = `<div class="playlist-thumb" style="${art}"></div>
            <div class="playlist-info"><strong>${escapeHtml(decodeApiText(song.name || song.title || 'Unknown'))}</strong>
            <span>${escapeHtml(decodeApiText(getArtistName(song)))}</span></div>`;
        row.onclick = () => startPlay(song, recent, index);
        list.appendChild(row);
    });
}
function refreshListeningHistory() {
    renderRecentlyPlayed();
    renderSidebarRecents();
    highlightActiveRailRow();
}

/* Home collection filter pills -------------------------------------------------- */
let homeCollectionFilter = 'all';
function setHomeCollectionFilter(kind) {
    homeCollectionFilter = ['all', 'liked', 'albums', 'artists'].includes(kind) ? kind : 'all';
    document.querySelectorAll('#homeCollectionPills .pill').forEach(pill => {
        const active = pill.dataset.filter === homeCollectionFilter;
        pill.classList.toggle('active', active);
        pill.setAttribute('aria-pressed', String(active));
    });
    renderHomeCollections();
}
function renderHomeCollections() {
    const grid = document.getElementById('homePlaylistsGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const add = (element) => grid.appendChild(element);
    const empty = (message, actionLabel, action) => {
        const note = document.createElement('div');
        note.className = 'shelf-empty';
        note.style.gridColumn = '1 / -1';
        if (actionLabel) {
            const button = document.createElement('button');
            button.className = 'ghost-btn small';
            button.innerHTML = actionLabel;
            button.onclick = action;
            note.appendChild(button);
        }
        add(note);
    };

    if (homeCollectionFilter === 'all') {
        const create = document.createElement('div');
        create.className = 'collection-tile create';
        create.innerHTML = '<i class="fas fa-plus" aria-hidden="true"></i><span>Create Playlist</span>';
        create.onclick = () => openCreatePlaylistModal();
        add(create);
        if (!userPlaylists.length) {
            const note = document.createElement('div');
            note.className = 'shelf-empty';
            note.textContent = 'No playlists yet — create one, then it shows up here.';
            add(note);
            return;
        }
        userPlaylists.forEach((pl, index) => {
            const tile = document.createElement('div');
            tile.className = 'collection-tile';
            tile.dataset.playlistId = pl.id;
            const count = (pl.songs || []).length;
            tile.innerHTML = tileMarkup({ title: pl.name, subtitle: count + (count === 1 ? ' song' : ' songs'), image: [], color: getPlaylistColor(pl) }, index, { icon: 'fa-list-music' });
            tile.onclick = () => showPlaylistDetail(pl, pl.songs || [], 'Your Playlist', true);
            add(tile);
        });
        return;
    }

    if (homeCollectionFilter === 'liked') {
        const liked = Storage.getLiked();
        if (!liked.length) { empty('Tap ♥ on a song and it lands in Liked Songs.', '<i class="fas fa-heart"></i> Browse favorites', () => navigateTo('favorites')); return; }
        liked.slice(0, 12).forEach((song, index) => {
            const tile = document.createElement('div');
            tile.className = 'collection-tile';
            tile.innerHTML = tileMarkup({ title: decodeApiText(song.name || song.title || 'Unknown'), subtitle: decodeApiText(getArtistName(song)), image: song.image }, index);
            tile.onclick = () => startPlay(song, liked, index);
            add(tile);
        });
        return;
    }

    const kind = homeCollectionFilter;
    const seen = Storage.get(kind === 'albums' ? 'seen_albums' : 'seen_artists') || [];
    if (!seen.length) {
        empty(kind === 'albums' ? 'Open an album from search or the Albums page and it is bookmarked here.'
                                : 'Open an artist and their profile shows up here.',
            kind === 'albums' ? '<i class="fas fa-compact-disc"></i> Browse albums' : '<i class="fas fa-microphone-lines"></i> Browse artists',
            () => navigateTo(kind));
        return;
    }
    seen.forEach((item, index) => {
        const tile = document.createElement('div');
        tile.className = 'collection-tile';
        tile.innerHTML = tileMarkup({ title: item.name, subtitle: item.artist, image: item.image }, index,
            { icon: kind === 'albums' ? 'fa-compact-disc' : 'fa-user', round: kind === 'artists' });
        tile.onclick = async () => {
            showToast('Loading ' + item.name, 2000);
            if (kind === 'albums') {
                const data = await callApi('/api/albums', { id: item.id });
                if (data && data.songs && data.songs.length) { showPlaylistDetail({ name: item.name }, data.songs, item.artist); navigateTo('playlists'); }
                else showToast('No songs found for this album');
            } else {
                const data = await callApi('/api/artists/' + item.id + '/songs', { page: 0, limit: 30 });
                if (data && data.songs && data.songs.length) { navigateTo('artists'); showArtistDetail({ id: item.id, name: item.name, image: item.image }, data.songs); }
                else showToast('No songs found for this artist');
            }
        };
        add(tile);
    });
}
function showLikedSongsPlaylist() {
    const liked = Storage.getLiked();
    if (!liked.length) { navigateTo('favorites'); showToast('No liked songs yet — tap ♥ on any track'); return; }
    navigateTo('playlists');
    showPlaylistDetail({ name: 'Liked Songs' }, liked, 'Your favourites');
}

/* Right rail: trending + recently added ----------------------------------------- */
let railSongs = new Map();
let trendingSongs = [];
let recentlyAddedExpanded = false;
function railRowMarkup(song, index, options) {
    const opts = options || {};
    const img = getImage(song);
    const art = img && img !== APP_LOGO ? `background-image:url('${escapeHtml(img)}')` : '';
    const name = decodeApiText(song.name || song.title || 'Unknown');
    return `<span class="rail-rank">${opts.rank ? index + 1 : ''}</span>
        <div class="rail-thumb"${art ? ` style="${art}"` : ''}>${art ? '' : '<i class="fas fa-music"></i>'}</div>
        <div class="rail-copy"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(decodeApiText(getArtistName(song)))}</span></div>
        <button class="rail-action${opts.like ? ' is-like' : ''}" data-row-action="${escapeHtml(opts.action || 'menu')}" title="${opts.like ? 'Remove from favorites' : 'More options'}">
            <i class="fas ${opts.like ? 'fa-heart liked-mark' : 'fa-ellipsis'}"></i>
        </button>`;
}
function bindRailRow(row, song, queue, options) {
    const opts = options || {};
    row.dataset.songId = String(song.id);
    railSongs.set(String(song.id), song);
    row.onclick = event => {
        if (event.target.closest('.rail-action')) return;
        startPlay(song, queue, queue.indexOf(song));
    };
    row.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); startPlay(song, queue, queue.indexOf(song)); } };
    const action = row.querySelector('.rail-action');
    if (action) action.onclick = event => {
        event.stopPropagation();
        if (opts.like) removeFavorite(event, song.id);
        else openRowMenu(event, song);
    };
}
const TRENDING_FALLBACK_QUERY = 'trending songs';
async function loadTrendingRail(force) {
    const list = document.getElementById('trendingRailList');
    if (!list) return;
    if (!trendingSongs.length || force) {
        list.innerHTML = '<div class="rail-loading"><i class="fas fa-spinner fa-spin"></i> Loading trends\u2026</div>';
    }
    let songs = [];
    let source = '';
    const trending = await callApi('/api/trending/songs', { page: 1, limit: 5 });
    const trendingResults = Array.isArray(trending) ? trending : (trending && trending.results) || [];
    if (trendingResults.length) { songs = trendingResults.slice(0, 5); source = 'live'; }
    if (!songs.length) {
        // Different endpoint on the same API: works when the trending route is down.
        const search = await callApi('/api/search/songs', { query: TRENDING_FALLBACK_QUERY, page: 0, limit: 5 });
        const found = (search && search.results) || [];
        if (found.length) { songs = found.slice(0, 5); source = 'live'; }
    }
    if (!songs.length && discoveryPool.length) {
        songs = shuffleSongs(discoveryPool).slice(0, 5); source = 'pool';
    }
    if (!songs.length) {
        const cached = Storage.get('trending') || [];
        if (cached.length) { songs = cached.slice(0, 5); source = 'cached'; }
    }
    if (!songs.length) {
        const recent = Storage.getRecent();
        if (recent.length) { songs = recent.slice(0, 5); source = 'recent'; }
    }
    if (source === 'live') Storage.set('trending', songs);
    trendingSongs = songs;
    railSongs = new Map();
    list.innerHTML = '';
    if (!trendingSongs.length) {
        list.innerHTML = '<div class="rail-empty rail-degraded">Trending feed is unreachable right now \u2014 playback, '
            + 'search and your collections still work.<button class="ghost-btn small" onclick="loadTrendingRail(true)">'
            + '<i class="fas fa-rotate"></i> Retry</button></div>';
        return;
    }
    trendingSongs.forEach((song, index) => {
        const row = document.createElement('div');
        row.className = 'rail-row';
        row.tabIndex = 0;
        row.innerHTML = railRowMarkup(song, index, { rank: true });
        bindRailRow(row, song, trendingSongs);
        list.appendChild(row);
    });
    if (source !== 'live') {
        const note = document.createElement('div');
        note.className = 'rail-note';
        note.innerHTML = '<i class="fas fa-plug-circle-xmark"></i> ' + (source === 'pool'
            ? 'From the latest discovery pool' : source === 'recent' ? 'From your recent plays'
            : 'Last list that loaded \u00b7 offline');
        list.appendChild(note);
    }
    highlightActiveRailRow();
}
function renderRecentlyAdded() {
    const list = document.getElementById('recentlyAddedList');
    if (!list) return;
    const liked = Storage.getLiked();
    const shown = recentlyAddedExpanded ? liked.slice(0, 20) : liked.slice(0, 5);
    const expand = document.getElementById('recentlyAddedExpand');
    if (expand) {
        expand.style.display = liked.length > 5 ? 'block' : 'none';
        expand.innerHTML = `<i class="fas ${recentlyAddedExpanded ? 'fa-chevron-up' : 'fa-chevron-down'}"></i>`;
        expand.title = recentlyAddedExpanded ? 'Show less' : 'Show more';
    }
    if (!liked.length) { list.innerHTML = '<div class="rail-empty">Tap ♥ on a song and it lands here.</div>'; return; }
    list.innerHTML = '';
    shown.forEach((song, index) => {
        const row = document.createElement('div');
        row.className = 'rail-row';
        row.tabIndex = 0;
        row.innerHTML = railRowMarkup(song, index, { like: true });
        bindRailRow(row, song, shown, { like: true });
        list.appendChild(row);
    });
    highlightActiveRailRow();
}
function toggleRecentlyAddedExpand() {
    recentlyAddedExpanded = !recentlyAddedExpanded;
    renderRecentlyAdded();
}
function highlightActiveRailRow() {
    const activeId = currentSong ? String(currentSong.id) : '';
    document.querySelectorAll('.rail-row').forEach(row => {
        row.classList.toggle('active', Boolean(activeId) && row.dataset.songId === activeId);
    });
}

/* Row "…" menu -------------------------------------------------------------------- */
let rowMenuSong = null;
function openRowMenu(event, song) {
    rowMenuSong = song;
    const menu = document.getElementById('rowActionMenu');
    if (!menu) return;
    const label = menu.querySelector('[data-like-label]');
    if (label) label.textContent = isSongLiked(song) ? 'Remove from favourites' : 'Add to favourites';
    menu.style.display = 'flex';
    const button = event.currentTarget.getBoundingClientRect();
    const width = menu.offsetWidth || 186;
    const height = menu.offsetHeight || 110;
    menu.style.left = Math.max(8, Math.min(window.innerWidth - width - 8, button.right - width)) + 'px';
    menu.style.top = Math.min(window.innerHeight - height - 8, button.bottom + 6) + 'px';
}
function closeRowMenu() {
    const menu = document.getElementById('rowActionMenu');
    if (menu) menu.style.display = 'none';
    rowMenuSong = null;
}
function rowMenuAction(action) {
    const song = rowMenuSong;
    closeRowMenu();
    if (!song) return;
    if (action === 'play') {
        const queue = trendingSongs.some(item => String(item.id) === String(song.id)) ? trendingSongs : [song];
        startPlay(song, queue, queue.indexOf(song));
    } else if (action === 'playlist') {
        openAddToPlaylistModal(song);
    } else {
        const liked = Storage.getLiked();
        const index = liked.findIndex(item => String(item.id) === String(song.id));
        if (index > -1) { liked.splice(index, 1); showToast('Removed from Favorites'); }
        else { liked.unshift(song); showToast('♥ Added to Favorites'); }
        Storage.set('liked', liked);
        if (currentSong && String(currentSong.id) === String(song.id)) isLiked = index < 0;
        updateLikeUI();
        updateFavCount();
        renderRecentlyAdded();
        if (document.getElementById('page-favorites').classList.contains('active')) loadFavorites();
    }
}

/* Sidebar status + boot ------------------------------------------------------------ */
window.onEqualizerState = function (state) {
    const label = document.getElementById('sidebarEqLabel');
    const sub = document.getElementById('sidebarEqSub');
    if (label) label.textContent = state.blocked ? 'Original audio' : state.enabled ? 'EQ · ' + state.title : 'EQ bypassed';
    if (sub) sub.textContent = state.blocked ? 'EQ unavailable for this stream'
        : state.playing ? (state.enabled
            ? (state.gains.every(g => g === 0) ? 'Live processing · flat bands'
                : 'Live processing · ' + state.gains.map((v, i) => v === 0 ? '' :
                    ['60 Hz', '250 Hz', '1 kHz', '4 kHz', '12 kHz'][i] + ' ' + (v > 0 ? '+' : '−') + Math.abs(v) + ' dB')
                    .filter(Boolean).join(' · '))
            : 'Playing, EQ off')
        : 'Idle · paused';
};
function initConsolePanels() {
    renderHeroDots();
    setHeroVibe(0);
    preloadHeroArtwork();
    startHeroRotation();
    renderRecentlyPlayed();
    renderSidebarRecents();
    renderHomeCollections();
    loadTrendingRail();
    renderRecentlyAdded();
    window.addEventListener('online', () => loadTrendingRail(true));
    setHomeCollectionFilter('all');
    document.addEventListener('click', event => {
        const menu = document.getElementById('rowActionMenu');
        if (menu && menu.style.display !== 'none' && !event.target.closest('#rowActionMenu')) closeRowMenu();
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeRowMenu(); });
}
