// Stats reader lab: how bright are the digits really? For every cell where the old reader and the
// saved stats agree, the brightest 20% of each ink piece (at a low cut-off), split into
// zeros (drawn faint) and other digits (drawn white). Picks the cut-off between them.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { STAT_ORDER, cellRect } from '../../public/js/rules/endscreen.js';
import { inkPieces } from '../../public/js/rules/glyphs.js';

const LAB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'ocr-lab');
const current = JSON.parse(readFileSync(join(LAB, 'current.json'), 'utf8'));
const matches = JSON.parse(readFileSync(join(LAB, 'matches.json'), 'utf8'));
const shotMatch = new Map(matches.flatMap((m) => m.shots.map((s) => [s, m])));
const val = (c) => (c && typeof c === 'object' ? c.value : c);
const zeros = []; const others = [];
for (const [shot, r] of Object.entries(current)) {
  if (!r.layout) continue;
  const m = shotMatch.get(shot);
  if (!m) continue;
  const { data, info } = await sharp(readFileSync(join(LAB, 'shots', shot))).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const g = new Uint8Array(info.width * info.height);
  for (let p = 0, i = 0; p < g.length; p++, i += info.channels) { const sat = Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]); g[p] = sat > 60 ? 0 : Math.round(0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2]); }
  const saved = Object.values(m.saved);
  for (const [pi, p] of r.panels.entries()) {
    for (const row of p.rows) {
      const s = saved.find((x) => STAT_ORDER.filter((k) => val(row.stats[k]) != null && x[k] === val(row.stats[k])).length >= 6);
      if (!s) continue;
      for (const k of STAT_ORDER) {
        if (r.layout.panels[pi].cols[k] === undefined || s[k] == null || val(row.stats[k]) !== s[k]) continue;
        const rect = cellRect(r.layout, r.layout.panels[pi], k, row.row);
        const left = Math.max(0, Math.round(rect.left)); const top = Math.max(0, Math.round(rect.top));
        const w = Math.min(info.width - left, Math.round(rect.width)); const h = Math.min(info.height - top, Math.round(rect.height));
        if (w < 4 || h < 4) continue;
        const cell = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) cell.set(g.subarray((top + y) * info.width + left, (top + y) * info.width + left + w), y * w);
        const pieces = inkPieces({ data: cell, width: w, height: h }, { level: 95 });
        if (!pieces.length) continue;
        // The brightest fifth of the ink in the cell.
        const vals = [];
        for (const pc of pieces) for (let y = pc.y0; y <= pc.y1; y++) for (let x = pc.x0; x <= pc.x1; x++) if (cell[y * w + x] >= 95) vals.push(cell[y * w + x]);
        vals.sort((a, b) => b - a);
        const top20 = vals.slice(0, Math.max(1, Math.round(vals.length * 0.2)));
        const v = top20.reduce((a, b) => a + b, 0) / top20.length;
        (s[k] === 0 ? zeros : others).push(Math.round(v));
      }
    }
  }
}
const q = (a, f) => a.sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))];
console.log(`zeros (${zeros.length}): min ${q(zeros, 0)} 5% ${q(zeros, 0.05)} median ${q(zeros, 0.5)} 95% ${q(zeros, 0.95)} max ${q(zeros, 1)}`);
console.log(`other digits (${others.length}): min ${q(others, 0)} 5% ${q(others, 0.05)} median ${q(others, 0.5)} 95% ${q(others, 0.95)} max ${q(others, 1)}`);
