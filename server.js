'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

let FFMPEG = null;
try {
  FFMPEG = require('ffmpeg-static') || null;
} catch (e) {
  FFMPEG = null;
}

const PORT = process.env.PORT || 8000;
const ROOT = __dirname;

process.on('uncaughtException', (e) => {
  console.error('[uncaught]', e && e.message);
});
process.on('unhandledRejection', (e) => {
  console.error('[unhandled]', e && e.message);
});

let WebTorrent = null;
try {
  WebTorrent = require('webtorrent');
} catch (e) {
  // newer webtorrent ships ESM-only; load lazily below
}

async function loadWebTorrent() {
  if (WebTorrent) return WebTorrent;
  try {
    const mod = await import('webtorrent');
    WebTorrent = mod.default || mod;
  } catch (e2) {
    console.log('webtorrent failed to load - streaming disabled: ' + e2.message);
  }
  return WebTorrent;
}

const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://explodie.org:6969/announce',
  'udp://exodus.desync.com:6969/announce',
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

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

function extToMime(name) {
  const ext = path.extname(name).toLowerCase();
  if (['.mp4', '.m4v', '.mpeg', '.mpg'].includes(ext)) return 'video/mp4';
  if (['.mkv'].includes(ext)) return 'video/x-matroska';
  if (['.webm'].includes(ext)) return 'video/webm';
  if (['.avi'].includes(ext)) return 'video/x-msvideo';
  if (['.mov'].includes(ext)) return 'video/quicktime';
  if (['.ts', '.m2ts'].includes(ext)) return 'video/mp2t';
  if (['.mp3'].includes(ext)) return 'audio/mpeg';
  if (['.m4a', '.aac', '.ogg', '.flac', '.wav'].includes(ext)) return 'audio/mpeg';
  return null;
}

let client = null;
const streams = new Map();
const metaCache = new Map();
function timeout(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJSON(u) {
  const res = await fetch(u, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  if (!res.ok) throw new Error('upstream ' + res.status);
  return res.json();
}

function sendJSON(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(obj));
}

function sendError(res, code, message) {
  sendJSON(res, code, { error: message });
}

async function getTorrent(hash) {
  let t = streams.get(hash);
  if (!t) {
    t = client.add(magnet(hash), {});
    t.on('error', () => {});
    streams.set(hash, t);
  }
  if (!t.ready && !t.metadata) {
    const ok = await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(true); } };
      t.once('metadata', finish);
      setTimeout(() => { if (!done) { done = true; resolve(false); } }, 45000);
      t.once('error', () => finish(false));
    });
    if (!ok) return null;
  }
  return t;
}

async function handleStream(req, res, seg) {
  if (!client) {
    return sendError(res, 503, 'streaming disabled');
  }
  const [hash, fileIdx] = seg;
  if (!hash || fileIdx === undefined) return sendError(res, 400, 'bad stream path');
  const t = await getTorrent(hash);
  if (!t) return sendError(res, 504, 'metadata timeout - no peers yet, try again');
  const file = t.files[parseInt(fileIdx, 10)];
  if (!file) return sendError(res, 404, 'file not found');
  const fileType = extToMime(file.name);
  if (!fileType) return sendError(res, 415, 'file is not a playable media file');

  const range = req.headers.range;
  const total = file.length;
  let start = 0;
  let end = total - 1;
  let code = 200;

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      if (m[1]) start = parseInt(m[1], 10);
      if (m[2]) end = parseInt(m[2], 10);
      code = 206;
    }
  }
  end = Math.min(end, total - 1);
  const len = end - start + 1;

  res.writeHead(code, {
    'Content-Type': fileType,
    'Accept-Ranges': 'bytes',
    'Content-Length': len,
    'Content-Range': `bytes ${start}-${end}/${total}`,
    'Cache-Control': 'no-store',
  });
  const rs = file.createReadStream({ start, end });
  rs.on('error', () => {});
  rs.on('end', () => {
    if (!res.writableEnded) res.end();
  });
  rs.pipe(res);
  res.on('close', () => { if (!res.writableEnded) rs.destroy(); });
  res.on('error', () => { rs.destroy(); });
}

async function handleTranscode(req, res, seg) {
  if (!client) return sendError(res, 503, 'streaming disabled');
  if (!FFMPEG) return sendError(res, 501, 'ffmpeg not available');
  const [hash, fileIdx] = seg;
  if (!hash || fileIdx === undefined) return sendError(res, 400, 'bad transcode path');
  const t = await getTorrent(hash);
  if (!t) return sendError(res, 504, 'metadata timeout - no peers yet, try again');
  const file = t.files[parseInt(fileIdx, 10)];
  if (!file) return sendError(res, 404, 'file not found');
  if (!extToMime(file.name)) return sendError(res, 415, 'file is not a playable media file');

  res.writeHead(200, {
    'Content-Type': 'video/mp4',
    'Cache-Control': 'no-store',
    'Transfer-Encoding': 'chunked',
  });

  const rs = file.createReadStream();
  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-i', 'pipe:0',
    '-map', '0:v:0', '-map', '0:a:0',
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '192k', '-ac', '2',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-frag_duration', '2000000',
    '-f', 'mp4',
    'pipe:1',
  ];
  const ff = spawn(FFMPEG, args, { stdio: ['pipe', 'pipe', 'pipe'] });

  let ffErr = '';
  ff.stderr.on('data', (d) => { ffErr = (ffErr + d.toString()).slice(-4000); });

  let killed = false;
  const cleanup = () => {
    if (killed) return;
    killed = true;
    try { rs.destroy(); } catch (e) {}
    ff.kill('SIGKILL');
  };
  req.on('close', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);

  let gotData = false;
  const firstChunk = setTimeout(() => {
    if (!gotData) {
      if (!res.writableEnded) res.end();
      cleanup();
    }
  }, 12000);

  ff.stdout.on('data', () => { gotData = true; clearTimeout(firstChunk); });
  ff.on('error', (e) => {
    if (!res.writableEnded) res.end();
    cleanup();
  });
  ff.stdout.on('error', () => {});
  ff.on('exit', (code) => {
    if (!res.writableEnded) res.end();
    if (code !== 0 && code !== null && !res.headersSent) {
      res.end();
    }
  });

  rs.on('error', () => { cleanup(); });
  rs.pipe(ff.stdin);
  ff.stdout.pipe(res);
}

async function handleApiTorrent(req, res, hash) {
  if (!client) return sendError(res, 503, 'streaming disabled - install webtorrent');
  const t = await getTorrent(hash);
  if (!t) return sendError(res, 504, 'metadata timeout - no peers yet, try again');
  const files = t.files
    .map((f, i) => ({ index: i, name: f.name, size: f.length, type: extToMime(f.name) }))
    .filter((f) => f.type !== null);
  sendJSON(res, 200, {
    name: t.name,
    hash: hash,
    magnet: t.magnetURI,
    progress: t.progress,
    downloadSpeed: t.downloadSpeed,
    files: files.filter((f) => f.type.startsWith('video') || f.type.startsWith('audio')),
  });
}

async function handleSearch(res, q) {
  try {
    const rows = await fetchJSON(`https://apibay.org/q.php?q=${encodeURIComponent(q)}`);
    const data = Array.isArray(rows) ? rows : [];
    if (data.length === 1 && /no results/i.test(data[0].name)) {
      return sendJSON(res, 200, { results: [], notice: 'No results found.' });
    }
    sendJSON(res, 200, { results: normalize(data) });
  } catch (e) {
    sendError(res, 502, 'Pirate Bay API unreachable: ' + e.message);
  }
}

async function handleTop(res) {
  try {
    const rows = await fetchJSON('https://apibay.org/precompiled/data_top100_all.json');
    sendJSON(res, 200, { results: normalize(Array.isArray(rows) ? rows : []) });
  } catch (e) {
    sendError(res, 502, 'Pirate Bay API unreachable: ' + e.message);
  }
}

async function fetchMetaCached(imdb) {
  if (!/^tt\d+$/.test(imdb)) return null;
  const cached = metaCache.get(imdb);
  if (cached && Date.now() - cached.t < 24 * 3600 * 1000) {
    return cached.meta;
  }

  const tryFetch = async (type) => {
    try {
      const rows = await fetchJSON(`https://v3-cinemeta.strem.io/meta/${type}/${imdb}.json`);
      const m = rows && rows.meta;
      if (!m) return null;
      return {
        imdb: imdb,
        name: m.name,
        year: m.year,
        type: m.type || type,
        poster: m.poster || '',
        background: m.background || m.poster || '',
      };
    } catch (e) {
      return null;
    }
  };

  const [movie, series] = await Promise.all([tryFetch('movie'), tryFetch('series')]);
  let meta = movie;
  if ((movie && !movie.poster) || !movie) {
    meta = series || movie;
  }
  if (!meta) return null;

  metaCache.set(imdb, { t: Date.now(), meta });
  return meta;
}

async function handleMeta(res, imdb) {
  const meta = await fetchMetaCached(imdb);
  if (!meta) return sendError(res, 404, 'no metadata found for ' + imdb);
  sendJSON(res, 200, meta);
}

async function handleMetas(res, idsRaw) {
  const ids = String(idsRaw || '').split(',').filter((x) => /^tt\d+$/.test(x)).slice(0, 100);
  if (!ids.length) return sendJSON(res, 200, { metas: {} });
  const metas = {};
  let i = 0;
  const worker = async () => {
    while (i < ids.length) {
      const id = ids[i++];
      const meta = await fetchMetaCached(id);
      if (meta) metas[id] = meta;
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  sendJSON(res, 200, { metas });
}

function serveStatic(req, res, pathname) {
  let p = pathname;
  if (p === '/') p = '/index.html';
  const filePath = path.join(ROOT, p);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); return res.end();
  }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const seg = u.pathname.split('/').filter(Boolean);

  try {
    if (seg[0] === 'api') {
      if (seg[1] === 'status') return sendJSON(res, 200, { ffmpeg: !!FFMPEG });
      if (seg[1] === 'search') {
        const q = u.searchParams.get('q');
        if (!q) return sendError(res, 400, 'missing q');
        return await handleSearch(res, q);
      }
      if (seg[1] === 'top') return await handleTop(res);
      if (seg[1] === 'meta' && seg[2]) return await handleMeta(res, seg[2]);
      if (seg[1] === 'metas') return await handleMetas(res, u.searchParams.get('ids'));
      if (seg[1] === 'torrent' && seg[2]) return await handleApiTorrent(req, res, seg[2].toLowerCase());
      return sendError(res, 404, 'unknown api');
    }
    if (seg[0] === 'stream' && seg[1] && seg[2]) {
      return await handleStream(req, res, [seg[1].toLowerCase(), seg[2]]);
    }
    if (seg[0] === 'transcode' && seg[1] && seg[2]) {
      return await handleTranscode(req, res, [seg[1].toLowerCase(), seg[2]]);
    }
    serveStatic(req, res, u.pathname);
  } catch (e) {
    if (!res.headersSent) sendError(res, 500, e.message);
    else res.end();
  }
});

async function start() {
  await loadWebTorrent();
  if (WebTorrent) client = new WebTorrent();
  server.listen(PORT, () => {
    console.log('');
    console.log('  Stremio Web running at:  http://localhost:' + PORT);
    console.log('  Streaming: ' + (client ? 'ENABLED (webtorrent)' : 'DISABLED - could not load webtorrent'));
    console.log('');
  });
}

start();
