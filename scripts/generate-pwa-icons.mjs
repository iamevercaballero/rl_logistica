#!/usr/bin/env node
/**
 * generate-pwa-icons.mjs
 * Pure Node.js (no extra deps) — generates public/icon-192.png and public/icon-512.png
 * Design: blue (#2563eb) rounded-rect background + white "RL" bitmap monogram.
 *
 * Usage:  node scripts/generate-pwa-icons.mjs
 */

import { deflateSync } from 'zlib';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ── CRC32 ─────────────────────────────────────────────────────────────────── */
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[i] = c;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function u32be(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; }
function pngChunk(type, data) {
  const tb = Buffer.from(type, 'ascii');
  return Buffer.concat([u32be(data.length), tb, data, u32be(crc32(Buffer.concat([tb, data])))]);
}

/* ── 5×7 bitmap glyphs ─────────────────────────────────────────────────────── */
const GLYPHS = {
  R: [
    [1,1,1,1,0],
    [1,0,0,0,1],
    [1,0,0,0,1],
    [1,1,1,1,0],
    [1,0,1,0,0],
    [1,0,0,1,0],
    [1,0,0,0,1],
  ],
  L: [
    [1,0,0,0,0],
    [1,0,0,0,0],
    [1,0,0,0,0],
    [1,0,0,0,0],
    [1,0,0,0,0],
    [1,0,0,0,0],
    [1,1,1,1,1],
  ],
};

/* ── PNG generator ─────────────────────────────────────────────────────────── */
function makePNG(size) {
  // RGBA buffer (4 bytes per pixel)
  const buf = new Uint8Array(size * size * 4);

  // Brand blue background with rounded corners
  const r = Math.round(size * 0.22); // corner radius ≈ 22 % of size

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Is this pixel inside the rounded rect?
      let inCorner = false;
      let cx = 0, cy = 0;
      if      (x < r     && y < r)            { cx = r;       cy = r;       inCorner = true; }
      else if (x >= size - r && y < r)        { cx = size-r-1; cy = r;      inCorner = true; }
      else if (x < r     && y >= size - r)    { cx = r;       cy = size-r-1; inCorner = true; }
      else if (x >= size - r && y >= size-r)  { cx = size-r-1; cy = size-r-1; inCorner = true; }

      const inside = !inCorner || (x-cx)*(x-cx) + (y-cy)*(y-cy) <= r*r;

      if (inside) {
        buf[idx]   = 37;   // R #2563eb
        buf[idx+1] = 99;   // G
        buf[idx+2] = 235;  // B
        buf[idx+3] = 255;  // A (opaque)
      }
      // else: transparent (0,0,0,0) — default Uint8Array value
    }
  }

  // Draw RL glyphs in white
  const scale = Math.max(1, Math.floor(size * 0.36 / 7));
  const gW    = 5 * scale;
  const gH    = 7 * scale;
  const gap   = Math.max(scale, Math.round(size * 0.04));
  const startX = Math.round((size - (gW * 2 + gap)) / 2);
  const startY = Math.round((size - gH) / 2);

  function drawGlyph(glyph, ox) {
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (!glyph[row][col]) continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = ox + col * scale + sx;
            const py = startY + row * scale + sy;
            if (px < 0 || px >= size || py < 0 || py >= size) continue;
            const i = (py * size + px) * 4;
            buf[i] = 255; buf[i+1] = 255; buf[i+2] = 255; buf[i+3] = 255;
          }
        }
      }
    }
  }

  drawGlyph(GLYPHS.R, startX);
  drawGlyph(GLYPHS.L, startX + gW + gap);

  // Build raw scanlines: filter byte (0 = None) + RGBA per row
  const rowBytes = size * 4;
  const raw = new Uint8Array(size * (rowBytes + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (rowBytes + 1)] = 0; // filter: None
    raw.set(buf.subarray(y * rowBytes, (y + 1) * rowBytes), y * (rowBytes + 1) + 1);
  }

  // IHDR: width, height, bit-depth=8, color-type=6 (RGBA)
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // RGBA

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(Buffer.from(raw))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── Write files ───────────────────────────────────────────────────────────── */
const publicDir = join(__dirname, '..', 'logistica-palets-frontend', 'public');
mkdirSync(publicDir, { recursive: true });

writeFileSync(join(publicDir, 'icon-192.png'), makePNG(192));
writeFileSync(join(publicDir, 'icon-512.png'), makePNG(512));

console.log('✓ icon-192.png (192×192) generated');
console.log('✓ icon-512.png (512×512) generated');
console.log(`  → ${publicDir}`);
