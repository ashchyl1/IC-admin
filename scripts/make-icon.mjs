/**
 * Generate build/icon.png — the source electron-builder derives every platform
 * icon from.
 *
 *   node scripts/make-icon.mjs
 *
 * Written as a raw PNG encoder rather than pulled from a library because the
 * icon is eleven line segments on a flat background, and a build dependency for
 * that is a poor trade. Node's zlib does the only hard part.
 *
 * The mark is an Elliott impulse — five waves up in Kite blue.
 */

import { deflateSync } from "node:zlib";
import { Buffer } from "node:buffer";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const SIZE = 512;
const BG = [0x38, 0x7e, 0xd1]; // Kite blue
const INK = [0xff, 0xff, 0xff];

// RGBA canvas, opaque background.
const pixels = Buffer.alloc(SIZE * SIZE * 4);
for (let i = 0; i < SIZE * SIZE; i += 1) {
  pixels[i * 4] = BG[0];
  pixels[i * 4 + 1] = BG[1];
  pixels[i * 4 + 2] = BG[2];
  pixels[i * 4 + 3] = 0xff;
}

/** Alpha-blend one pixel — the cheap way to get antialiased edges. */
function blend(x, y, colour, alpha) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE || alpha <= 0) return;
  const at = (y * SIZE + x) * 4;
  const a = Math.min(1, alpha);
  for (let c = 0; c < 3; c += 1) {
    pixels[at + c] = Math.round(pixels[at + c] * (1 - a) + colour[c] * a);
  }
}

function disc(cx, cy, radius, colour) {
  const from = Math.floor(cx - radius - 1);
  const to = Math.ceil(cx + radius + 1);
  const top = Math.floor(cy - radius - 1);
  const bottom = Math.ceil(cy + radius + 1);
  for (let y = top; y <= bottom; y += 1) {
    for (let x = from; x <= to; x += 1) {
      const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      blend(x, y, colour, radius + 0.5 - distance);
    }
  }
}

/** Thick line as a swept disc: round joins and caps for free. */
function stroke(x1, y1, x2, y2, width, colour) {
  const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2);
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    disc(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, width / 2, colour);
  }
}

// An impulse: origin, 1, 2, 3, 4, 5. Wave 3 is the longest, wave 4 stays clear
// of wave 1 — the icon obeys the rules the application enforces.
const wave = [
  [62, 436],
  [150, 300],
  [196, 358],
  [306, 138],
  [356, 214],
  [452, 78],
];

for (let i = 0; i < wave.length - 1; i += 1) {
  stroke(wave[i][0], wave[i][1], wave[i + 1][0], wave[i + 1][1], 30, INK);
}
for (const [x, y] of wave) {
  disc(x, y, 20, INK);
  disc(x, y, 10, BG);
}

// ------------------------------------------------------------------ encode ---

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

// PNG wants a filter byte in front of every scanline; 0 means "none".
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y += 1) {
  raw[y * (SIZE * 4 + 1)] = 0;
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA


const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

// One location, committed: it is both the window icon at runtime and the source
// electron-builder derives every platform icon from.
for (const target of ["electron/icon.png"]) {
  const file = path.join(process.cwd(), target);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, png);
  console.log(`wrote ${target} (${SIZE}×${SIZE}, ${(png.length / 1024).toFixed(1)} kB)`);
}
