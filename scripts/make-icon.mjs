// Generates media/icon.png (256x256): highlighted text lines in the default category colors on the
// gallery-banner background. Dependency-free (zlib + hand-rolled PNG chunks); a placeholder until
// real artwork replaces it. Run with: node scripts/make-icon.mjs

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const SIZE = 256;
const BACKGROUND = [0x1f, 0x29, 0x37];
const PAGE = [0xf3, 0xf4, 0xf6];
const INK = [0x37, 0x41, 0x51];
const CATEGORY_COLORS = [
  [0xff, 0xff, 0x98],
  [0x53, 0xff, 0xbc],
  [0x80, 0xeb, 0xff],
  [0xff, 0x4f, 0x5f],
  [0xff, 0xcb, 0xe6],
];

const pixels = Buffer.alloc(SIZE * SIZE * 4);

function put(x, y, [r, g, b], alpha = 255) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) {
    return;
  }
  const offset = (y * SIZE + x) * 4;
  const blend = alpha / 255;
  pixels[offset] = Math.round(pixels[offset] * (1 - blend) + r * blend);
  pixels[offset + 1] = Math.round(pixels[offset + 1] * (1 - blend) + g * blend);
  pixels[offset + 2] = Math.round(pixels[offset + 2] * (1 - blend) + b * blend);
  pixels[offset + 3] = Math.max(pixels[offset + 3], alpha);
}

/** Coverage of a rounded rect at (x, y); 1 inside, 0 outside, fractional on the corner arc. */
function roundedCoverage(x, y, left, top, width, height, radius) {
  const right = left + width - 1;
  const bottom = top + height - 1;
  if (x < left || x > right || y < top || y > bottom) {
    return 0;
  }
  const cx = x < left + radius ? left + radius : x > right - radius ? right - radius : x;
  const cy = y < top + radius ? top + radius : y > bottom - radius ? bottom - radius : y;
  if (cx === x && cy === y) {
    return 1;
  }
  const distance = Math.hypot(x - cx, y - cy);
  return Math.max(0, Math.min(1, radius + 0.5 - distance));
}

function fillRounded(left, top, width, height, radius, color, alpha = 255) {
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) {
      const coverage = roundedCoverage(x, y, left, top, width, height, radius);
      if (coverage > 0) {
        put(x, y, color, Math.round(alpha * coverage));
      }
    }
  }
}

fillRounded(0, 0, SIZE, SIZE, 44, BACKGROUND);
fillRounded(40, 28, 176, 200, 14, PAGE);

const lines = [
  { width: 120, color: null },
  { width: 144, color: CATEGORY_COLORS[0] },
  { width: 128, color: null },
  { width: 136, color: CATEGORY_COLORS[1] },
  { width: 144, color: CATEGORY_COLORS[3] },
  { width: 112, color: null },
  { width: 132, color: CATEGORY_COLORS[2] },
];
let y = 52;
for (const line of lines) {
  if (line.color) {
    fillRounded(56, y - 5, line.width + 8, 24, 11, line.color);
  }
  fillRounded(60, y, line.width, 12, 6, INK, line.color ? 210 : 120);
  y += 25;
}

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c;
});

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const stride = SIZE * 4;
const raw = Buffer.alloc((stride + 1) * SIZE);
for (let row = 0; row < SIZE; row += 1) {
  pixels.copy(raw, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
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

const target = join(dirname(fileURLToPath(import.meta.url)), "..", "media", "icon.png");
writeFileSync(target, png);
console.log(`wrote ${target} (${png.length} bytes)`);
