'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makeIcon(size) {
  const w = size;
  const h = size;
  const px = Buffer.alloc(w * h * 4);

  function set(x, y, r, g, b, a) {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  }

  // rounded-rect background (near black)
  const radius = w * 0.22;
  const bg1 = [28, 28, 30];
  const bg2 = [6, 6, 8];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = (x + y) / (w + h);
      const r = Math.round(bg1[0] + (bg2[0] - bg1[0]) * t);
      const g = Math.round(bg1[1] + (bg2[1] - bg1[1]) * t);
      const b = Math.round(bg1[2] + (bg2[2] - bg1[2]) * t);

      let inRect = true;
      const cx = Math.max(radius - x, x - (w - radius), 0);
      const cy = Math.max(radius - y, y - (h - radius), 0);
      if (cx * cx + cy * cy > radius * radius) inRect = false;
      set(x, y, r, g, b, inRect ? 255 : 0);
    }
  }

  // red rounded-square tile
  const tileSize = w * 0.7;
  const tileR = tileSize * 0.22;
  const tileX0 = (w - tileSize) / 2;
  const tileY0 = (h - tileSize) / 2;
  const tileX1 = tileX0 + tileSize;
  const tileY1 = tileY0 + tileSize;
  const red = [229, 9, 20];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < tileX0 || x >= tileX1 || y < tileY0 || y >= tileY1) continue;
      const dx = Math.max(tileX0 + tileR - x, x - (tileX1 - tileR), 0);
      const dy = Math.max(tileY0 + tileR - y, y - (tileY1 - tileR), 0);
      if (dx * dx + dy * dy > tileR * tileR) continue;
      set(x, y, red[0], red[1], red[2], 255);
    }
  }

  // play triangle with rounded corners - simple polygon
  const cx = w / 2;
  const cy = h / 2;
  const r = w * 0.26;
  const tip = { x: cx - r * 0.72, y: cy - r * 0.9 };
  const p1 = { x: cx + r * 0.72, y: cy };
  const p2 = { x: cx - r * 0.72, y: cy + r * 0.9 };

  function pointInTri(px, py) {
    const d1 = (px - p1.x) * (tip.y - p1.y) - (tip.x - p1.x) * (py - p1.y);
    const d2 = (px - p2.x) * (p1.y - p2.y) - (p1.x - p2.x) * (py - p2.y);
    const d3 = (px - tip.x) * (p2.y - tip.y) - (p2.x - tip.x) * (py - tip.y);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (pointInTri(x, y)) {
        set(x, y, 255, 255, 255, 255);
      }
    }
  }

  // raw -> RGBA scanlines
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const rowStart = y * (1 + w * 4);
    raw[rowStart] = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      raw[rowStart + 1 + x * 4] = px[i];
      raw[rowStart + 2 + x * 4] = px[i + 1];
      raw[rowStart + 3 + x * 4] = px[i + 2];
      raw[rowStart + 4 + x * 4] = px[i + 3];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return png;
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon-192.png'), makeIcon(192));
fs.writeFileSync(path.join(outDir, 'icon-512.png'), makeIcon(512));
console.log('Icons written to ' + outDir);
