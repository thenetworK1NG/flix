'use strict';

const CATS = {
  movies: new Set([201, 202, 204, 207, 209, 200]),
  tv: new Set([205, 208]),
};

const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://explodie.org:6969/announce',
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.fastcast.nz',
];

const BROWSER_VIDEO = new Set(['mp4', 'm4v', 'webm', 'ogv']);
const BROWSER_AUDIO = new Set(['mp3', 'm4a', 'aac', 'ogg', 'opus', 'wav']);
const REMUXABLE = new Set(['mkv', 'mov', 'ts', 'm2ts', 'mts']);

const state = {
  top: [],
  items: new Map(),
  metas: {},
  client: null,
  renderer: null,
  mediabunny: null,
  mse: null,
  mseUrl: null,
  msePlayback: null,
  activeStreams: new Map(),
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

function fmtSpeed(bytes) {
  return fmtSize(bytes) + '/s';
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

function extOf(name) {
  return (String(name).split('.').pop() || '').toLowerCase();
}

function extToMime(name) {
  const ext = extOf(name);
  const video = {
    mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg',
    mkv: 'video/x-matroska', avi: 'video/x-msvideo', mov: 'video/quicktime',
    ts: 'video/mp2t', m2ts: 'video/mp2t', flv: 'video/x-flv', wmv: 'video/x-ms-wmv',
  };
  const audio = {
    mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg',
    opus: 'audio/ogg', flac: 'audio/flac', wav: 'audio/wav',
  };
  return video[ext] || audio[ext] || null;
}

function browserPlayable(name) {
  const ext = extOf(name);
  return BROWSER_VIDEO.has(ext) || BROWSER_AUDIO.has(ext);
}

function remuxable(name) {
  return REMUXABLE.has(extOf(name));
}

function magnet(hash, name) {
  const dn = encodeURIComponent(name || hash);
  return `magnet:?xt=urn:btih:${hash}&dn=${dn}&tr=${TRACKERS.map((t) => encodeURIComponent(t)).join('&tr=')}`;
}

function normalize(rows) {
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    hash: r.info_hash,
    seeds: parseInt(r.seeders, 10) || 0,
    leeches: parseInt(r.leechers, 10) || 0,
    size: parseInt(r.size, 10) || 0,
    added: parseInt(r.added, 10) || 0,
    category: parseInt(r.category, 10) || 0,
    imdb: r.imdb || '',
    magnet: magnet(r.info_hash, r.name),
  }));
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('upstream ' + res.status);
  return res.json();
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

function metaFor(imdb) {
  if (!imdb || !/^tt\d+$/.test(imdb)) return null;
  if (metaCache.has(imdb)) return metaCache.get(imdb);
  const meta = {
    imdb: imdb,
    name: '',
    year: null,
    poster: `https://images.metahub.space/poster/medium/${imdb}/img`,
    background: `https://images.metahub.space/background/medium/${imdb}/img`,
  };
  metaCache.set(imdb, meta);
  return meta;
}

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

function hydrateCard(card, t) {
  const meta = metaFor(t.imdb);
  if (meta) applyPoster(card, meta);
  else applyDefault(card);
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
    const rows = await fetchJSON('https://apibay.org/precompiled/data_top100_all.json');
    state.top = normalize(Array.isArray(rows) ? rows : []);
    state.metas = {};
    state.top.forEach((t) => {
      const meta = metaFor(t.imdb);
      if (meta) state.metas[t.imdb] = meta;
    });

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
    renderGrid($('#moviesGrid'), [], 'Failed to reach The Pirate Bay API. Check your connection.');
    renderGrid($('#tvGrid'), [], 'Failed to reach The Pirate Bay API. Check your connection.');
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
    const rows = await fetchJSON('https://apibay.org/q.php?q=' + encodeURIComponent(q));
    const raw = Array.isArray(rows) ? rows : [];
    if (raw.length === 1 && /no results/i.test(raw[0].name)) {
      meta.textContent = 'No results found. Try a different spelling.';
      renderGrid($('#searchGrid'), [], 'No results found.');
      return;
    }
    const list = normalize(raw);
    meta.textContent = `${list.length} result${list.length === 1 ? '' : 's'} found for "${q}".`;
    renderGrid($('#searchGrid'), list, 'No results. Try a different spelling.');
  } catch (e) {
    meta.textContent = 'Search failed: ' + e.message;
    renderGrid($('#searchGrid'), [], 'Failed to reach The Pirate Bay API.');
  } finally {
    showSpinner(false);
  }
}

// ---------- webtorrent ----------
function getTorrent(t) {
  if (!state.client) return Promise.reject(new Error('WebTorrent not loaded - check your connection'));
  const magnetURI = t.magnet;
  let torrent = state.client.get(magnetURI);
  if (!torrent) torrent = state.client.add(magnetURI);
  return new Promise((resolve, reject) => {
    if (torrent.ready || torrent.metadata) return resolve(torrent);
    const timer = setTimeout(() => reject(new Error('metadata timeout - no peers yet, try again')), 45000);
    torrent.once('ready', () => { clearTimeout(timer); resolve(torrent); });
    torrent.once('error', (e) => { clearTimeout(timer); reject(e || new Error('torrent error')); });
  });
}

function torrentFiles(torrent) {
  return torrent.files
    .map((f, i) => ({ index: i, name: f.name, size: f.length, type: extToMime(f.name) }))
    .filter((f) => f.type);
}

function copyMagnet(t) {
  const uri = t.magnet || magnet(t.hash, t.name);
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(uri).then(() => showToast('Magnet link copied.'), () => prompt('Copy this magnet link:', uri));
  } else {
    prompt('Copy this magnet link:', uri);
  }
}

// ---------- detail ----------
async function openDetail(t) {
  const modal = $('#modalBackdrop');
  const head = $('#detailHead');
  const title = $('#detailTitle');
  const body = $('#detailBody');
  const meta = metaCache.get(t.imdb) || metaFor(t.imdb);
  const bg = (meta && (meta.background || meta.poster)) || '';

  title.textContent = t.name;
  head.style.backgroundImage = bg ? `url("${bg}")` : '';

  body.innerHTML = `
    <div class="detail-actions">
      <button class="btn-play" id="playBtn">${PLAY_ICON.replace('width="100" height="100"', 'width="18" height="18"')} Play now</button>
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
  $('#magnetBtn').onclick = () => copyMagnet(t);
  $('#openBtn').onclick = () => window.open(t.magnet, '_blank');

  try {
    const torrent = await getTorrent(t);
    renderFiles(body, torrent, t);
  } catch (e) {
    $('#filesLoading').textContent = 'Playback unavailable: ' + e.message + '. Use the magnet link with a torrent app instead.';
  }
}

async function playTorrent(t) {
  showSpinner(true, 'Connecting to peers...');
  try {
    const torrent = await getTorrent(t);
    const media = torrentFiles(torrent).filter((f) => f.type.startsWith('video') || f.type.startsWith('audio'));
    if (!media.length) throw new Error('no playable media files in this torrent');
    const pick = media.find((f) => f.type.startsWith('video') && browserPlayable(f.name)) ||
      media.find((f) => f.type.startsWith('video')) ||
      media[0];
    const file = torrent.files[pick.index];
    if (!browserPlayable(pick.name)) {
      if (remuxable(pick.name) && state.mediabunny) {
        startStream(torrent, file, pick.name, true);
        return;
      }
      alert('Browsers cannot play ' + extOf(pick.name).toUpperCase() + ' files. Use the magnet link with VLC instead.');
      return;
    }
    startStream(torrent, file, torrent.name || t.name);
  } catch (e) {
    alert('Could not start stream: ' + e.message + '. Try the magnet link with a torrent app instead.');
  } finally {
    showSpinner(false);
  }
}

function renderFiles(container, torrent, t) {
  const host = container.querySelector('.detail-files');
  const files = torrentFiles(torrent);
  const videos = files.filter((f) => f.type.startsWith('video'));
  const others = files.filter((f) => f.type.startsWith('audio'));

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
    const native = browserPlayable(f.name);
    const remux = !native && remuxable(f.name) && !!state.mediabunny;
    const mode = native ? 'native' : (remux ? 'remux' : 'vlc');
    const badge = mode === 'vlc'
      ? '<button class="tc-btn" title="Browsers cannot play this format - open the magnet in VLC">VLC</button>'
      : '<button class="play-btn">Play</button>';
    const size = mode === 'vlc' ? `${fmtSize(f.size)} · VLC only` : fmtSize(f.size);
    html += `<div class="file-row play-file" data-hash="${t.hash}" data-index="${f.index}" data-mode="${mode}">
      <span class="fname">${f.icon} ${esc(f.name)}</span>
      <span class="fsize">${size}</span>
      <span class="row-btns">${badge}</span>
    </div>`;
  });
  host.innerHTML = html;

  $$('.play-file').forEach((row) => {
    const play = () => {
      $('#modalBackdrop').hidden = true;
      const file = torrent.files[parseInt(row.dataset.index, 10)];
      if (!file) return;
      if (row.dataset.mode === 'remux') startStream(torrent, file, file.name, true);
      else if (row.dataset.mode === 'native') startStream(torrent, file, file.name);
      else copyMagnet(t);
    };
    row.querySelector('.play-btn, .tc-btn').onclick = (e) => {
      e.stopPropagation();
      play();
    };
    row.onclick = play;
  });
}

// ---------- streaming ----------
function destroyRenderer() {
  if (state.renderer) {
    try { state.renderer.remove(); } catch (e) {}
    state.renderer = null;
  }
}

function closeMsePlayback() {
  const p = state.msePlayback;
  state.msePlayback = null;
  if (p) {
    try { p.conversion.cancel(); } catch (e) {}
    try { p.input.dispose(); } catch (e) {}
  }
  if (state.mseUrl) {
    try { URL.revokeObjectURL(state.mseUrl); } catch (e) {}
    state.mseUrl = null;
  }
  state.mse = null;
}

function stopPlayback() {
  destroyRenderer();
  closeMsePlayback();
  const player = $('#player');
  if (player) player.src = '';
}

function startStream(torrent, file, name, remux) {
  if (!state.client) {
    showToast('WebTorrent unavailable');
    return;
  }
  stopPlayback();
  const player = $('#player');
  $('#playerTitle').textContent = name || torrent.name;
  $('#playerStatus').textContent = 'Connecting to peers...';
  $('#playerHint').textContent = remux
    ? `Remuxing ${extOf(name).toUpperCase()} in your browser - start may take a moment. Audio needs a supported codec (AAC/MP3/Opus); for AC3/DTS use the magnet link in VLC.`
    : 'Playing in your browser over WebTorrent. No sound or won\'t play? Use the magnet link in VLC.';
  $('#playerBackdrop').hidden = false;

  player.src = '';

  if (remux) {
    playRemuxed(torrent, file, name);
    return;
  }

  file.renderTo(player, { autoplay: true }, (err, renderer) => {
    if (err) {
      $('#playerStatus').textContent = 'Could not render: ' + (err.message || 'unknown error');
      return;
    }
    state.renderer = renderer;
  });

  const onDownload = () => {
    $('#playerStatus').textContent = torrent.done ? 'Download complete' : `Streaming... ${fmtSpeed(torrent.downloadSpeed)}`;
  };
  torrent.on('download', onDownload);
  torrent.on('done', onDownload);

  player.onplaying = () => { $('#playerStatus').textContent = 'Streaming...'; };
  player.onerror = () => {
    $('#playerStatus').textContent = 'Stream error - the torrent may have no peers. Try a different release.';
  };

  state.activeStreams.set(torrent.infoHash, { name: name || torrent.name, torrent, fileIndex: file.index });
  renderActiveStreams();
}

function readRange(file, start, end) {
  return new Promise((resolve, reject) => {
    let rs;
    try { rs = file.createReadStream({ start, end: end - 1 }); } catch (e) { reject(e); return; }
    const buf = new Uint8Array(end - start);
    let off = 0;
    rs.on('data', (c) => { buf.set(c, off); off += c.length; });
    rs.on('end', () => resolve(buf));
    rs.on('error', reject);
  });
}

function makeMseSink() {
  let sb = null;
  const queue = [];
  let draining = Promise.resolve();

  const waitUpdate = () => new Promise((resolve) => {
    const done = () => { sb.removeEventListener('updateend', done); resolve(); };
    sb.addEventListener('updateend', done, { once: true });
  });

  const trimTo = async (keepSeconds) => {
    if (!sb || sb.updating || !sb.buffered.length) return false;
    const end = sb.buffered.end(sb.buffered.length - 1);
    const start = sb.buffered.start(0);
    if (end - start <= keepSeconds) return false;
    await new Promise((resolve) => {
      const done = () => { sb.removeEventListener('updateend', done); resolve(); };
      sb.addEventListener('updateend', done, { once: true });
      sb.remove(0, end - keepSeconds);
    });
    return true;
  };

  const appendOne = async (data) => {
    if (!sb) return;
    for (;;) {
      try {
        sb.appendBuffer(data);
        break;
      } catch (e) {
        if (e.name !== 'QuotaExceededError' || !(await trimTo(30))) throw e;
      }
    }
    await waitUpdate();
  };

  const pump = () => {
    draining = draining
      .then(async () => {
        while (queue.length) {
          await trimTo(120);
          await appendOne(queue.shift());
        }
      })
      .catch((e) => console.error('MSE append error', e));
    return draining;
  };

  return {
    writable: new WritableStream({
      write(chunk) {
        queue.push(chunk.data);
        if (sb) pump();
      },
    }),
    attach(_sb) { sb = _sb; if (queue.length) pump(); },
    flushEnd() { return pump(); },
  };
}

async function initMse(mimeType, sink) {
  const player = $('#player');
  const ms = new MediaSource();
  state.mseUrl = URL.createObjectURL(ms);
  player.src = state.mseUrl;
  await new Promise((resolve, reject) => {
    const onOpen = () => {
      try {
        const sb = ms.addSourceBuffer(mimeType);
        sink.attach(sb);
        resolve();
      } catch (e) { reject(e); }
    };
    ms.addEventListener('sourceopen', onOpen, { once: true });
    ms.addEventListener('error', () => {
      ms.removeEventListener('sourceopen', onOpen);
      reject(new Error('MediaSource error'));
    }, { once: true });
  });
  state.mse = ms;
}

async function playRemuxed(torrent, file, name) {
  const mb = state.mediabunny;
  if (!mb) {
    $('#playerStatus').textContent = 'Playback engine not loaded - use the magnet link with VLC instead.';
    return;
  }
  const player = $('#player');
  $('#playerStatus').textContent = `Preparing ${extOf(name).toUpperCase()} (remuxing in browser)...`;
  const sink = makeMseSink();
  let input = null;
  let conversion = null;
  try {
    const source = new mb.CustomSource({
      getSize: async () => file.length,
      read: (start, end) => readRange(file, start, end),
      maxCacheSize: 16 * 1024 * 1024,
      prefetchProfile: 'network',
    });
    input = new mb.Input({ source, formats: mb.ALL_FORMATS });
    const output = new mb.Output({
      format: new mb.Mp4OutputFormat({ fastStart: 'fragmented' }),
      target: new mb.StreamTarget(sink.writable),
    });
    conversion = await mb.Conversion.init({
      input,
      output,
      tracks: 'primary',
      composable: true,
      showWarnings: false,
      video: async (track) => ((await track.canDecode()) ? {} : { discard: true }),
      audio: async (track) => ((await track.canDecode()) ? {} : { discard: true }),
    });
    state.msePlayback = { input, conversion };
    const audioDiscarded = conversion.discardedTracks.some((d) => d.track && d.track.isAudioTrack());
    if (!conversion.utilizedTracks.some((t) => t.isVideoTrack())) {
      throw new Error('video codec not supported by your browser');
    }
    await output.start();
    const mimeType = await output.getMimeType();
    await initMse(mimeType, sink);
    player.play().catch(() => {});
    if (audioDiscarded) showToast('Audio codec not supported - playing video only. Use the magnet in VLC for sound.');
    $('#playerStatus').textContent = 'Streaming...';
    state.activeStreams.set(torrent.infoHash, { name: name || torrent.name, torrent, fileIndex: file.index });
    renderActiveStreams();
    await conversion.execute();
    await output.finalize();
    await sink.flushEnd();
    const ms = state.mse;
    if (ms && ms.readyState === 'open') ms.endOfStream();
  } catch (e) {
    const msg = (e && e.message) || String(e);
    player.src = '';
    closeMsePlayback();
    $('#playerStatus').textContent = 'Remux failed: ' + msg + '. Use the magnet link with VLC instead.';
  }
}

function renderActiveStreams() {
  const box = $('#linksPanel');
  if (!state.activeStreams.size) {
    box.innerHTML = '<p class="empty">Nothing streaming yet. Play a torrent from the grid.</p>';
    return;
  }
  let html = '';
  state.activeStreams.forEach((s) => {
    const pct = Math.round((s.torrent.progress || 0) * 100);
    html += `<div class="file-row">
      <span class="fname">▶ ${esc(s.name)}</span>
      <span class="fsize">${pct}% · ${fmtSpeed(s.torrent.downloadSpeed)}</span>
      <button class="stop-btn">Replay</button>
    </div>`;
  });
  box.innerHTML = html;
  $$('#linksPanel .file-row').forEach((row, idx) => {
    row.onclick = () => {
      const s = [...state.activeStreams.values()][idx];
      const file = s.torrent.files[s.fileIndex];
      if (file) startStream(s.torrent, file, s.name);
    };
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
    if (e.target === bd) {
      if (bd.id === 'playerBackdrop') stopPlayback();
      bd.hidden = true;
    }
  });
});

$$('.close-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const bd = btn.closest('.modal-backdrop');
    if (bd.id === 'playerBackdrop') stopPlayback();
    bd.hidden = true;
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    $$('.modal-backdrop').forEach((m) => (m.hidden = true));
    stopPlayback();
  }
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
function init() {
  playIntro();
  if (typeof WebTorrent !== 'undefined') {
    try {
      state.client = new WebTorrent();
    } catch (e) {
      state.client = null;
    }
  }
  if (typeof Mediabunny !== 'undefined') state.mediabunny = Mediabunny;
  loadHome();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
