'use strict';

const CATS = {
  movies: new Set([201, 202, 204, 207, 209, 200]),
  tv: new Set([205, 208]),
};

const state = {
  top: [],
  items: new Map(),
  metas: {},
  activeStreams: new Map(),
  ffmpeg: false,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ---------- helpers ----------
function fmtSize(bytes) {
  if (!bytes) return '?';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return n.toFixed(i > 1 ? 1 : 0) + ' ' + units[i];
}

function fmtDate(ts) {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleDateString();
}

function hashColor(hash, salt) {
  let h = 0;
  const s = (hash || 'flix') + (salt || '');
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

function posterGradient(hash) {
  const h1 = hashColor(hash, 'a');
  const h2 = (h1 + 40) % 360;
  return `linear-gradient(150deg, hsl(${h1} 45% 24%), hsl(${h2} 50% 12%))`;
}

function initials(name) {
  const words = (name || '').replace(/[\[\]\(\)]/g, ' ').trim().split(/\s+/).filter(Boolean);
  const letters = words
    .filter((w) => /[A-Za-z0-9]/.test(w[0]))
    .map((w) => w[0].toUpperCase())
    .slice(0, 3)
    .join('');
  return letters || '?';
}

function categoryLabel(cat) {
  const map = {
    201: 'Movies', 202: 'Movies DVDR', 204: 'Movies HD', 207: 'Movies HD',
    205: 'TV Shows', 208: 'TV HD', 209: '3D', 203: 'Music Videos',
  };
  return map[cat] || 'Video';
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function showToast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => (t.hidden = true), 2600);
}

function showSpinner(on, label) {
  const s = $('#spinner');
  s.hidden = !on;
  if (label) $('#spinnerText').textContent = label;
}

async function api(path) {
  const res = await fetch(path);
  const data = await res.json().catch(() => ({ error: 'bad response' }));
  if (data.error) throw new Error(data.error);
  return data;
}

// ---------- cards ----------
const DEFAULT_POSTER = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300">' +
  '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
  '<stop offset="0" stop-color="#1d2536"/><stop offset="1" stop-color="#0d1017"/>' +
  '</linearGradient></defs>' +
  '<rect width="200" height="300" fill="url(#g)"/>' +
  '<circle cx="100" cy="112" r="34" fill="none" stroke="#3b4760" stroke-width="4"/>' +
  '<polygon points="90,94 118,112 90,130" fill="#3b4760"/>' +
  '<text x="100" y="180" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="13" fill="#5a6784">No image</text>' +
  '</svg>'
);

const PLAY_ICON = '<svg viewBox="0 0 100 100"><polygon points="34,24 78,50 34,76" fill="#fff"/></svg>';

function cardHTML(t) {
  const grad = posterGradient(t.hash);
  return `
    <div class="card card-loading" data-hash="${t.hash}" data-id="${t.id}" data-imdb="${t.imdb || ''}">
      <div class="card-poster" style="background:${grad}">
        <span class="initials">${initials(t.name)}</span>
        <div class="play-ov">${PLAY_ICON}</div>
      </div>
      <div class="card-title">${esc(t.name)}</div>
    </div>`;
}

function flixCardHTML(t) {
  const meta = state.metas[t.imdb];
  const poster = (meta && meta.poster) || DEFAULT_POSTER;
  return `
    <div class="flix-card" data-hash="${t.hash}" data-id="${t.id}">
      <div class="flix-poster">
        <img src="${poster}" alt="" loading="lazy" onerror="this.closest('.flix-card').style.display='none'">
        <div class="play-ov">${PLAY_ICON}</div>
      </div>
      <div class="flix-title">${esc(t.name)}</div>
    </div>`;
}

// ---------- poster hydration (grid cards) ----------
const metaCache = new Map();
let metaQueue = [];
let metaBusy = false;

function revealCard(card) {
  if (card) card.classList.remove('card-loading');
}

function applyDefault(card) {
  if (card.dataset.hideNoimg === '1') {
    const grid = card.parentElement;
    card.classList.add('card-removing');
    setTimeout(() => {
      card.remove();
      if (grid && grid.querySelectorAll('.card').length === 0 && !grid.querySelector('.empty-note')) {
        grid.innerHTML = '<div class="empty-note">No posters available for this section right now.</div>';
      }
    }, 260);
    return;
  }
  const p = card.querySelector('.card-poster');
  if (p) {
    const init = p.querySelector('.initials');
    if (init) init.remove();
    const img = document.createElement('img');
    img.alt = '';
    img.src = DEFAULT_POSTER;
    p.insertBefore(img, p.firstChild);
  }
  revealCard(card);
}

function applyPoster(card, meta) {
  if (!meta || !meta.poster) return applyDefault(card);
  const p = card.querySelector('.card-poster');
  if (!p) return revealCard(card);
  const init = p.querySelector('.initials');
  if (init) init.remove();
  const img = document.createElement('img');
  img.alt = '';
  img.loading = 'lazy';
  img.onload = () => revealCard(card);
  img.onerror = () => { img.remove(); applyDefault(card); };
  img.src = meta.poster;
  p.insertBefore(img, p.firstChild);
}

async function scheduleMetaDrain() {
  if (metaBusy) return;
  metaBusy = true;
  while (metaQueue.length) {
    const batch = metaQueue.splice(0, 8);
    await Promise.all(batch.map(async ({ card, imdb }) => {
      if (metaCache.has(imdb)) {
        applyPoster(card, metaCache.get(imdb));
        return;
      }
      try {
        const j = await api('/api/meta/' + imdb);
        metaCache.set(imdb, j);
        applyPoster(card, j);
      } catch (e) {
        applyDefault(card);
      }
    }));
    await new Promise((r) => setTimeout(r, 40));
  }
  metaBusy = false;
}

function hydrateCard(card, t) {
  if (!t.imdb || !/^tt\d+$/.test(t.imdb)) {
    applyDefault(card);
    return;
  }
  if (metaCache.has(t.imdb)) {
    applyPoster(card, metaCache.get(t.imdb));
    return;
  }
  metaQueue.push({ card, imdb: t.imdb });
  scheduleMetaDrain();
}

function renderGrid(el, list, emptyMsg, opts) {
  opts = opts || {};
  if (!list.length) {
    el.innerHTML = `<div class="empty-note">${emptyMsg || 'No torrents found.'}</div>`;
    return;
  }
  list.forEach((t) => state.items.set(`${t.hash}:${t.id}`, t));
  el.innerHTML = list.map(cardHTML).join('');
  const cards = el.querySelectorAll('.card');
  if (opts.hideNoImage) cards.forEach((c) => (c.dataset.hideNoimg = '1'));
  list.forEach((t, i) => {
    const card = cards[i];
    if (card) hydrateCard(card, t);
  });
}

function renderFlixRow(id, list) {
  const el = document.getElementById(id);
  if (!el) return;
  const block = el.closest('.row-block');
  if (!list.length) {
    el.innerHTML = '';
    if (block) block.style.display = 'none';
    return;
  }
  if (block) block.style.display = '';
  list.forEach((t) => state.items.set(`${t.hash}:${t.id}`, t));
  el.innerHTML = list.map(flixCardHTML).join('');
}

// ---------- hero ----------
function renderHero(t) {
  const el = $('#heroBanner');
  if (!t) {
    el.style.display = 'none';
    return;
  }
  el.style.display = '';
  const meta = state.metas[t.imdb];
  const bg = (meta && (meta.background || meta.poster)) || '';
  el.style.backgroundImage = bg ? `url("${bg}")` : '';
  const name = (meta && meta.name) || t.name;
  const year = meta && meta.year ? String(meta.year) : '';
  el.innerHTML = `
    <div class="hero-shade"></div>
    <div class="hero-content">
      <h1>${esc(name)}</h1>
      <div class="hero-meta">${year} ${categoryLabel(t.category)} · ${fmtSize(t.size)}</div>
      <button class="hero-play">${PLAY_ICON.replace('width="100" height="100"', 'width="20" height="20"')} Play now</button>
    </div>`;
  el.querySelector('.hero-play').onclick = (e) => {
    e.stopPropagation();
    $('#modalBackdrop').hidden = true;
    playTorrent(t);
  };
  el.onclick = () => openDetail(t);
}

// ---------- data ----------
async function loadHome() {
  showSpinner(true, 'Loading FLIX...');
  try {
    const data = await api('/api/top');
    state.top = data.results || [];
    const imdbs = [...new Set(state.top.map((t) => t.imdb).filter((i) => i && /^tt\d+$/.test(i)))];
    const metaData = await api('/api/metas?ids=' + encodeURIComponent(imdbs.join(',')));
    state.metas = metaData.metas || {};
    Object.keys(state.metas).forEach((k) => metaCache.set(k, state.metas[k]));

    const withImg = state.top.filter((t) => state.metas[t.imdb] && state.metas[t.imdb].poster);
    const movies = withImg.filter((t) => CATS.movies.has(t.category));
    const tv = withImg.filter((t) => CATS.tv.has(t.category));

    renderHero(withImg.find((t) => state.metas[t.imdb].background) || withImg[0]);
    renderFlixRow('top10Row', withImg.slice(0, 10));
    renderFlixRow('moviesRow', movies.slice(0, 20));
    renderFlixRow('tvRow', tv.slice(0, 20));

    renderGrid($('#moviesGrid'), movies, 'No movie torrents found.');
    renderGrid($('#tvGrid'), tv, 'No TV torrents found.');
  } catch (e) {
    renderGrid($('#moviesGrid'), [], 'Failed to reach The Pirate Bay API. Is the server running?');
    renderGrid($('#tvGrid'), [], 'Failed to reach The Pirate Bay API. Is the server running?');
    showToast('Failed to load: ' + e.message);
  } finally {
    showSpinner(false);
  }
}

async function doSearch(q) {
  const meta = $('#searchMeta');
  meta.textContent = 'Searching...';
  showSpinner(true, 'Searching The Pirate Bay...');
  switchSection('search');
  renderGrid($('#searchGrid'), []);
  try {
    const data = await api('/api/search?q=' + encodeURIComponent(q));
    const list = data.results || [];
    meta.textContent = data.notice
      ? data.notice
      : `${list.length} result${list.length === 1 ? '' : 's'} found for "${q}".`;
    renderGrid($('#searchGrid'), list, 'No results. Try a different spelling.');
  } catch (e) {
    meta.textContent = 'Search failed: ' + e.message;
    renderGrid($('#searchGrid'), [], 'Failed to reach The Pirate Bay API.');
  } finally {
    showSpinner(false);
  }
}

// ---------- detail ----------
async function openDetail(t) {
  const modal = $('#modalBackdrop');
  const head = $('#detailHead');
  const title = $('#detailTitle');
  const body = $('#detailBody');
  const meta = metaCache.get(t.imdb);
  const bg = (meta && (meta.background || meta.poster)) || '';

  title.textContent = t.name;
  head.style.backgroundImage = bg ? `url("${bg}")` : '';

  body.innerHTML = `
    <div class="detail-actions">
      <button class="btn-play" id="playBtn">${PLAY_ICON.replace('width="100" height="100"', 'width="18" height="18"')} Play now</button>
      <button class="btn-dl" id="streamUrlBtn">Copy stream URL</button>
      <button class="btn-dl" id="magnetBtn">Copy magnet</button>
      <button class="btn-dl" id="openBtn">Open magnet</button>
    </div>
    <div class="detail-tags">
      <span class="tag">${categoryLabel(t.category)}</span>
      <span class="tag">${t.seeds} seeders</span>
      <span class="tag">${t.leeches} leechers</span>
      <span class="tag">${fmtSize(t.size)}</span>
      <span class="tag">${fmtDate(t.added)}</span>
    </div>
    <div class="detail-files">
      <h4>Files</h4>
      <p class="empty-note" id="filesLoading">Loading file list...</p>
    </div>`;

  modal.hidden = false;

  $('#playBtn').onclick = () => { modal.hidden = true; playTorrent(t); };
  $('#magnetBtn').onclick = async () => {
    try { await navigator.clipboard.writeText(t.magnet); showToast('Magnet link copied.'); }
    catch { prompt('Copy this magnet link:', t.magnet); }
  };
  $('#openBtn').onclick = () => {
    window.open('magnet:?' + new URLSearchParams({ xt: 'urn:btih:' + t.hash, dn: t.name }).toString(), '_blank');
  };

  try {
    const info = await api('/api/torrent/' + t.hash);
    const firstVideo = (info.files || []).find((f) => f.type.startsWith('video')) ||
      (info.files || []).find((f) => f.type.startsWith('audio'));
    $('#streamUrlBtn').onclick = async () => {
      const index = firstVideo ? firstVideo.index : 0;
      const url = `${location.origin}/stream/${info.hash}/${index}`;
      try { await navigator.clipboard.writeText(url); showToast('Stream URL copied - paste into VLC.'); }
      catch { prompt('Stream URL (open in VLC):', url); }
    };
    renderFiles(body, info);
  } catch (e) {
    $('#filesLoading').textContent = 'Playback unavailable: ' + e.message + '. Use the magnet link with a torrent app instead.';
  }
}

async function playTorrent(t) {
  showSpinner(true, 'Connecting to peers...');
  try {
    const info = await api('/api/torrent/' + t.hash);
    const media = (info.files || []).filter((f) => f.type.startsWith('video') || f.type.startsWith('audio'));
    if (!media.length) throw new Error('no playable media files in this torrent');
    const pick = media.find((f) => f.type.startsWith('video')) || media[0];
    startStream({ hash: t.hash, name: info.name || t.name, index: pick.index, transcode: /\.mkv$/i.test(pick.name) });
  } catch (e) {
    alert('Could not start stream: ' + e.message + '. Try the magnet link with a torrent app instead.');
  } finally {
    showSpinner(false);
  }
}

function renderFiles(container, info) {
  const host = container.querySelector('.detail-files');
  const videos = (info.files || []).filter((f) => f.type.startsWith('video'));
  const others = (info.files || []).filter((f) => f.type.startsWith('audio'));

  if (!videos.length && !others.length) {
    host.innerHTML = '<h4>Files</h4><p class="empty-note">No playable files found in this torrent.</p>';
    return;
  }

  let html = '<h4>Files</h4>';
  const all = [
    ...videos.map((f) => ({ ...f, icon: '▶' })),
    ...others.map((f) => ({ ...f, icon: '♪' })),
  ];
  all.forEach((f) => {
    const mkv = /\.mkv$/i.test(f.name);
    const directBtn = mkv
      ? `<button class="tc-btn" title="Streams the file as-is (seeking works, but audio may not play)">Direct</button>`
      : '';
    html += `<div class="file-row play-file" data-hash="${info.hash}" data-index="${f.index}" data-name="${esc(f.name)}" data-mkv="${mkv ? 1 : 0}">
      <span class="fname">${f.icon} ${esc(f.name)}</span>
      <span class="fsize">${fmtSize(f.size)}</span>
      <span class="row-btns">
        <button class="play-btn">Play${mkv ? ' with sound' : ''}</button>
        ${directBtn}
      </span>
    </div>`;
  });
  host.innerHTML = html;

  $$('.play-file').forEach((row) => {
    const mkv = row.dataset.mkv === '1';
    const play = (transcode) => {
      $('#modalBackdrop').hidden = true;
      startStream({ hash: row.dataset.hash, name: row.dataset.name, index: row.dataset.index, transcode });
    };
    row.querySelector('.play-btn').onclick = (e) => { e.stopPropagation(); play(mkv); };
    const direct = row.querySelector('.tc-btn');
    if (direct) direct.onclick = (e) => { e.stopPropagation(); play(false); };
    row.onclick = () => play(mkv);
  });
}

// ---------- streaming ----------
function startStream(t) {
  const index = t.index !== undefined ? t.index : 0;
  const key = `${t.hash}/${index}/${t.transcode ? 'tc' : 'raw'}`;
  const player = $('#player');
  $('#playerTitle').textContent = t.name;
  $('#playerStatus').textContent = t.transcode ? 'Converting audio...' : 'Connecting to peers...';
  $('#playerHint').textContent = t.transcode
    ? 'Audio is being converted to a compatible format (AAC).'
    : 'No sound? MKV files often use AC3/DTS audio the browser can\u2019t play. Click "Play with sound".';
  $('#playerBackdrop').hidden = false;

  const url = `${t.transcode ? '/transcode' : '/stream'}/${t.hash}/${index}`;
  player.src = url;
  player.load();
  player.play().catch(() => {});

  state.activeStreams.set(key, { name: t.name, url, transcode: !!t.transcode });
  renderActiveStreams();

  player.onplaying = () => { $('#playerStatus').textContent = 'Streaming...'; };
  player.onwaiting = () => { $('#playerStatus').textContent = 'Buffering...'; };
  player.onerror = () => {
    $('#playerStatus').textContent = 'Stream error - the torrent may have no peers. Try a different release.';
  };
}

function renderActiveStreams() {
  const box = $('#linksPanel');
  if (!state.activeStreams.size) {
    box.innerHTML = '<p class="empty">Nothing streaming yet. Play a torrent from the grid.</p>';
    return;
  }
  let html = '';
  state.activeStreams.forEach((s, key) => {
    const [hash, index] = key.split('/');
    html += `<div class="file-row" data-hash="${hash}" data-index="${index}" data-name="${esc(s.name)}" data-tc="${s.transcode ? 1 : 0}">
      <span class="fname">▶ ${esc(s.name)}</span>
      <span class="fsize">${s.transcode ? 'sound fix' : 'active'}</span>
      <button class="stop-btn">Replay</button>
    </div>`;
  });
  box.innerHTML = html;
  $$('#linksPanel .file-row').forEach((row) => {
    row.onclick = () => startStream({
      hash: row.dataset.hash, name: row.dataset.name, index: row.dataset.index, transcode: row.dataset.tc === '1',
    });
  });
}

// ---------- navigation ----------
function switchSection(name) {
  $$('.section').forEach((s) => s.classList.remove('active'));
  const sec = $('#section-' + name);
  if (sec) sec.classList.add('active');
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.nav === name));
}

$$('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchSection(btn.dataset.nav));
});
$('#brand').addEventListener('click', () => switchSection('home'));

$('#searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#searchInput').value.trim();
  if (q) doSearch(q);
});

$$('.modal-backdrop').forEach((bd) => {
  bd.addEventListener('click', (e) => {
    if (e.target === bd) bd.hidden = true;
  });
});

$$('.close-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    btn.closest('.modal-backdrop').hidden = true;
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $$('.modal-backdrop').forEach((m) => (m.hidden = true));
});

document.addEventListener('click', (e) => {
  const card = e.target.closest('.card, .flix-card');
  if (!card) return;
  const t = state.items.get(`${card.dataset.hash}:${card.dataset.id}`);
  if (t) openDetail(t);
});

// ---------- intro ----------
function playIntro() {
  const intro = $('#intro');
  if (!intro) return;
  setTimeout(() => intro.classList.add('fade'), 2600);
  setTimeout(() => intro.remove(), 3500);
}

// ---------- init ----------
async function init() {
  playIntro();
  loadHome();
  try {
    const st = await api('/api/status');
    state.ffmpeg = !!st.ffmpeg;
  } catch (e) { /* keep false */ }
  try {
    if ('serviceWorker' in navigator) await navigator.serviceWorker.register('sw.js');
  } catch (e) { /* sw not critical */ }
}

init();
