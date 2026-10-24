// Stats reader lab: a contact sheet of name areas: the player cell of each line, with where the
// reader looks (blue, nameSearchRect) and what it takes as the name (green, nameArea).
//   node scripts/ocr-lab/name-sheet.mjs [first] -> ocr-lab/sheets/names-<first>.png
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { nameSearchRect, rowCentre } from '../../public/js/rules/endscreen.js';
import { isNameInk, nameArea } from '../../public/js/rules/namepics.js';

const LAB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'ocr-lab');
const reads = JSON.parse(readFileSync(join(LAB, 'current.json'), 'utf8'));
// `low`: the lines in ocr-lab/names-low.json (names that look unlike the same player's other ones).
const low = process.argv[2] === 'low';
const first = low ? 0 : Number(process.argv[2] ?? 0);
mkdirSync(join(LAB, 'sheets'), { recursive: true });
const items = [];
if (low) {
  for (const l of JSON.parse(readFileSync(join(LAB, 'names-low.json'), 'utf8'))) {
    const r = reads[l.shot];
    items.push({ shot: l.shot, r, panel: r.layout.panels[l.panel], row: l.row, note: `${l.player} ${l.s}` });
  }
} else {
  for (const [shot, r] of Object.entries(reads)) {
    if (!r.layout) continue;
    for (const [pi, p] of r.panels.entries()) for (const row of p.rows) items.push({ shot, r, panel: r.layout.panels[pi], row: row.row });
  }
}
const W = 300; const H = 90; const COLS = 4; const N = 32;
const tiles = [];
for (const [j, it] of items.slice(first, first + N).entries()) {
  const g = it.r.layout.colGap;
  const cy = rowCentre(it.r.layout, it.panel, it.row);
  const sr = nameSearchRect(it.r.layout, it.panel, it.row);
  const buf = readFileSync(join(LAB, 'shots', it.shot));
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  // The name area, found as the reader would.
  const sl = Math.max(0, Math.round(sr.left)); const st = Math.max(0, Math.round(sr.top));
  const sw = Math.min(info.width - sl, Math.round(sr.width)); const sh = Math.min(info.height - st, Math.round(sr.height));
  const ink = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { const i = ((st + y) * info.width + sl + x) * info.channels; ink[y * sw + x] = isNameInk(data[i], data[i + 1], data[i + 2]) ? 1 : 0; }
  const a = nameArea(ink, sw, sh);
  const left = Math.max(0, Math.round(it.panel.playerX - 0.9 * g));
  const top = Math.max(0, Math.round(cy - 0.8 * g));
  const width = Math.min(info.width - left, Math.round(it.panel.cols.pts - 0.3 * g - left));
  const height = Math.min(info.height - top, Math.round(1.55 * g));
  const sw2 = Math.max(1, Math.round(width / 150));
  const box = Buffer.from(`<svg width="${width}" height="${height}">
    <rect x="${sl - left}" y="${st - top}" width="${sw}" height="${sh}" fill="none" stroke="#39f" stroke-width="${sw2}"/>
    ${a ? `<rect x="${sl - left + a.x0}" y="${st - top + a.y0}" width="${a.x1 - a.x0 + 1}" height="${a.y1 - a.y0 + 1}" fill="none" stroke="#0f0" stroke-width="${sw2}"/>` : ''}</svg>`);
  const part = await sharp(buf).extract({ left, top, width, height }).composite([{ input: box }]).png().toBuffer();
  const img = await sharp(part).resize(W, H - 18, { fit: 'contain', background: '#222' }).png().toBuffer();
  const label = Buffer.from(`<svg width="${W}" height="18"><rect width="100%" height="100%" fill="#111"/><text x="4" y="13" font-family="Arial" font-size="12" fill="#fff">#${first + j}${it.note ? ` ${String(it.note).replace(/[<>&"]/g, '')}` : ''}${a ? '' : ' (no name found)'}</text></svg>`);
  tiles.push({ input: label, left: (j % COLS) * W, top: Math.floor(j / COLS) * H }, { input: img, left: (j % COLS) * W, top: Math.floor(j / COLS) * H + 18 });
}
const rows = Math.ceil(Math.min(N, items.length - first) / COLS);
const out = join(LAB, 'sheets', low ? 'names-low.png' : `names-${first}.png`);
writeFileSync(out, await sharp({ create: { width: COLS * W, height: rows * H, channels: 3, background: '#333' } }).composite(tiles).png().toBuffer());
console.log(`${items.length} lines; ${out}`);
