// Draws the placeholder JVO app icon (a volleyball) as SVG + PNGs, with no extra packages.
// Run: npm run icons   -> writes public/icons/*
// Replace with JVO's real logo once it exists.

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = '#0a0e17';
const BALL = '#ffc533';

// Geometry in a 64-unit box: a ball with three curved seams spinning out from the centre.
const C = 32, R = 22, LINE = 3.2, SEAM_R = 30;
const seams = [-90, 30, 150].map((deg) => {
  const a = (deg * Math.PI) / 180;
  const u = [Math.cos(a), Math.sin(a)]; // centre -> seam-circle centre
  const perp = [-u[1], u[0]]; // direction the seam leaves the centre
  const S = [C + SEAM_R * u[0], C + SEAM_R * u[1]];
  // Where this seam meets the edge of the ball
  const along = (R * R) / (2 * SEAM_R);
  const h = Math.sqrt(R * R - along * along);
  const E = [C + along * u[0] + h * perp[0], C + along * u[1] + h * perp[1]];
  return { S, perp, E };
});

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function colourAt(x, y, scale) {
  const ux = C + (x - C) / scale;
  const uy = C + (y - C) / scale;
  const d = Math.hypot(ux - C, uy - C);
  if (d > R + LINE / 2) return BG;
  if (d > R - LINE / 2) return BG; // outline
  for (const { S, perp } of seams) {
    const onArc = Math.abs(Math.hypot(ux - S[0], uy - S[1]) - SEAM_R) < LINE / 2;
    const forward = (ux - C) * perp[0] + (uy - C) * perp[1] > -LINE / 2;
    if (onArc && forward) return BG;
  }
  return BALL;
}

function svg() {
  const f = (n) => +n.toFixed(2);
  const paths = seams
    .map(({ S, E }) => {
      const cross = (C - S[0]) * (E[1] - S[1]) - (C - S[1]) * (E[0] - S[0]);
      return `<path d="M${C} ${C}A${SEAM_R} ${SEAM_R} 0 0 ${cross > 0 ? 1 : 0} ${f(E[0])} ${f(E[1])}"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="${BG}"/>
  <circle cx="${C}" cy="${C}" r="${R}" fill="${BALL}" stroke="${BG}" stroke-width="${LINE}"/>
  <g fill="none" stroke="${BG}" stroke-width="${LINE}" stroke-linecap="round">${paths}</g>
</svg>
`;
}

function render(size, scale = 1) {
  const ss = 4; // 4x4 supersampling for smooth edges
  const rows = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = ((px + (sx + 0.5) / ss) / size) * 64;
          const y = ((py + (sy + 0.5) / ss) / size) * 64;
          const c = hex(colourAt(x, y, scale));
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const n = ss * ss;
      row[1 + px * 3] = Math.round(r / n);
      row[2 + px * 3] = Math.round(g / n);
      row[3 + px * 3] = Math.round(b / n);
    }
    rows.push(row);
  }
  return png(size, size, Buffer.concat(rows));
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(w, h, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = new URL(process.argv[2] ? `file:///${process.argv[2].replace(/\\/g, '/')}/` : '../public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL('icon.svg', out), svg());
writeFileSync(new URL('icon-192.png', out), render(192));
writeFileSync(new URL('icon-512.png', out), render(512));
writeFileSync(new URL('icon-maskable-512.png', out), render(512, 0.8));
writeFileSync(new URL('apple-touch-icon.png', out), render(180, 0.85));
console.log(`Icons written to ${out.pathname}`);
