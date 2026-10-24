// Stats reader lab: contact sheets of the cells where a reader and the saved stats disagree, to
// check by eye. Each tile: the cell (with a little room around it), enlarged, numbered.
//
//   node scripts/ocr-lab/sheet.mjs exact          -> ocr-lab/sheets/exact-<n>.png + the list printed
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { cellRect } from '../../public/js/rules/endscreen.js';

const LAB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'ocr-lab');
const which = process.argv[2] ?? 'exact';
const reads = JSON.parse(readFileSync(join(LAB, `${which}.json`), 'utf8'));
const diffs = JSON.parse(readFileSync(join(LAB, `${which}-diffs.json`), 'utf8'));
mkdirSync(join(LAB, 'sheets'), { recursive: true });

const TILE_W = 240;
const TILE_H = 120;
const COLS = 5;
const PER = 30;
const esc = (s) => String(s).replace(/[<>&"]/g, '');
for (let s = 0; s * PER < diffs.length; s++) {
  const part = diffs.slice(s * PER, s * PER + PER);
  const tiles = [];
  for (const [j, d] of part.entries()) {
    const r = reads[d.shot];
    const panel = r.layout.panels[d.panel];
    const rect = cellRect(r.layout, panel, d.stat, d.row);
    const pad = rect.width * 0.35;
    const meta = await sharp(readFileSync(join(LAB, 'shots', d.shot))).metadata();
    const left = Math.max(0, Math.round(rect.left - pad));
    const top = Math.max(0, Math.round(rect.top - pad * 0.6));
    const width = Math.min(meta.width - left, Math.round(rect.width + 2 * pad));
    const height = Math.min(meta.height - top, Math.round(rect.height + 1.2 * pad));
    const img = await sharp(readFileSync(join(LAB, 'shots', d.shot))).extract({ left, top, width, height }).resize(TILE_W, TILE_H - 22, { fit: 'contain', background: '#222' }).png().toBuffer();
    const i = s * PER + j;
    const label = Buffer.from(`<svg width="${TILE_W}" height="22"><rect width="100%" height="100%" fill="#111"/><text x="4" y="16" font-family="Arial" font-size="14" fill="#fff">#${i} ${esc(d.stat)}: read ${d.read} · saved ${d.saved}</text></svg>`);
    tiles.push({ input: label, left: (j % COLS) * TILE_W, top: Math.floor(j / COLS) * TILE_H });
    tiles.push({ input: img, left: (j % COLS) * TILE_W, top: Math.floor(j / COLS) * TILE_H + 22 });
  }
  const rows = Math.ceil(part.length / COLS);
  const out = join(LAB, 'sheets', `${which}-${s}.png`);
  writeFileSync(out, await sharp({ create: { width: COLS * TILE_W, height: rows * TILE_H, channels: 3, background: '#333' } }).composite(tiles).png().toBuffer());
  console.log(out);
}
