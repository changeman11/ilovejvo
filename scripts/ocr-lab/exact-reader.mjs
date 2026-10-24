// Stats reader lab, step 3: the NEW number reader (public/js/rules/glyphs.js: each digit matched
// against the game's own digits). Uses the table positions the current reader found
// (ocr-lab/current.json), so both read exactly the same cells.
//
//   node scripts/ocr-lab/exact-reader.mjs     -> ocr-lab/exact.json (same shape as current.json),
//                                               ocr-lab/templates.json (digits learned from everything)
//
// Learning: digit examples come only from cells where the current reader AND the saved stats say
// the same number (two independent sources agreeing), so lazily-confirmed stats can't teach it
// wrong. Testing is fair: each screenshot is read with digits learned from the OTHER screenshots.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { STAT_ORDER, cellRect } from '../../public/js/rules/endscreen.js';
import { inkPieces, brightPieces, normalise, learnTemplates, readCell, INK, FAINT } from '../../public/js/rules/glyphs.js';

const LAB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'ocr-lab');
const current = JSON.parse(readFileSync(join(LAB, 'current.json'), 'utf8'));
const matches = JSON.parse(readFileSync(join(LAB, 'matches.json'), 'utf8'));
const val = (c) => (c && typeof c === 'object' ? c.value : c);

// The grey picture of every screenshot (brightness), and each stat cell cut out of it.
async function grey(file) {
  const { data, info } = await sharp(readFileSync(join(LAB, 'shots', file))).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const g = new Uint8Array(info.width * info.height);
  for (let p = 0, i = 0; p < g.length; p++, i += info.channels) {
    const r = data[i]; const gg = data[i + 1]; const b = data[i + 2];
    // White and grey ink only: coloured things (green/pink names, red/yellow ping) count as dark.
    const sat = Math.max(r, gg, b) - Math.min(r, gg, b);
    g[p] = sat > 60 ? 0 : Math.round(0.3 * r + 0.59 * gg + 0.11 * b);
  }
  return { data: g, width: info.width, height: info.height };
}
export function cutCell(img, rect) {
  const left = Math.max(0, Math.round(rect.left));
  const top = Math.max(0, Math.round(rect.top));
  const width = Math.min(img.width - left, Math.round(rect.width));
  const height = Math.min(img.height - top, Math.round(rect.height));
  if (width < 4 || height < 4) return null;
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) data.set(img.data.subarray((top + y) * img.width + left, (top + y) * img.width + left + width), y * width);
  return { data, width, height };
}

// Pair each current-reader line with the saved player it agrees with most (as score.mjs does).
function pairLines(lines, saved) {
  const pairs = [];
  lines.forEach((l, li) => saved.forEach(([pid, s]) => {
    let same = 0; let n = 0;
    for (const k of STAT_ORDER) if (val(l.stats[k]) != null && s[k] != null) { n++; if (val(l.stats[k]) === s[k]) same++; }
    if (n && same >= Math.min(4, n - 1)) pairs.push({ li, pid, same });
  }));
  pairs.sort((a, b) => b.same - a.same);
  const uL = new Set(); const uP = new Set(); const out = new Map();
  for (const p of pairs) { if (uL.has(p.li) || uP.has(p.pid)) continue; uL.add(p.li); uP.add(p.pid); out.set(p.li, p.pid); }
  return out;
}

const shotMatch = new Map(matches.flatMap((m) => m.shots.map((s) => [s, m])));
const cells = []; // { shot, panel, row, stat, cell, label }
for (const [shot, r] of Object.entries(current)) {
  if (!r.layout) continue;
  const img = await grey(shot);
  const m = shotMatch.get(shot);
  const lines = r.panels.flatMap((p, pi) => p.rows.map((row) => ({ ...row, panel: pi })));
  const pairs = m ? pairLines(lines, Object.entries(m.saved)) : new Map();
  lines.forEach((l, li) => {
    const s = pairs.has(li) ? m.saved[pairs.get(li)] : null;
    for (const stat of STAT_ORDER) {
      const panel = r.layout.panels[l.panel];
      if (panel.cols[stat] === undefined) continue;
      const cell = cutCell(img, cellRect(r.layout, panel, stat, l.row));
      if (!cell) continue;
      const cur = val(l.stats[stat]);
      // A label only when both sources agree.
      const label = s && cur != null && s[stat] === cur ? String(cur) : null;
      cells.push({ shot, panel: l.panel, row: l.row, stat, cell, label });
    }
  });
}

// Digit examples from the agreed cells: one per digit piece, when the pieces line up with the number.
function samplesOf(c) {
  if (c.label == null) return [];
  let pieces = brightPieces(c.cell);
  let level = INK;
  if (!pieces.length && c.label === '0') { pieces = inkPieces(c.cell, { level: FAINT }); level = FAINT; }
  if (pieces.length !== c.label.length) return [];
  return pieces.map((p, i) => ({ digit: c.label[i], glyph: normalise(c.cell, p, level), shot: c.shot }));
}
const samples = cells.flatMap(samplesOf);
const byDigit = {};
for (const s of samples) byDigit[s.digit] = (byDigit[s.digit] ?? 0) + 1;
console.log(`${cells.length} cells, ${cells.filter((c) => c.label != null).length} agreed; ${samples.length} digit examples:`, byDigit);

// Read every screenshot with digits learned from the others.
const out = {};
const shots = [...new Set(cells.map((c) => c.shot))];
for (const shot of shots) {
  const templates = learnTemplates(samples.filter((s) => s.shot !== shot));
  const r = current[shot];
  out[shot] = { size: r.size, layout: r.layout, panels: r.panels.map((p) => ({ rows: p.rows.map((row) => ({ row: row.row, nameText: row.nameText, name: row.name, stats: {} })) })) };
  for (const c of cells.filter((x) => x.shot === shot)) {
    const line = out[shot].panels[c.panel].rows.find((x) => x.row === c.row);
    line.stats[c.stat] = readCell(c.cell, templates);
  }
}
writeFileSync(join(LAB, 'exact.json'), JSON.stringify(out));
const all = learnTemplates(samples);
writeFileSync(join(LAB, 'templates.json'), JSON.stringify(Object.fromEntries(Object.entries(all).map(([d, l]) => [d, l.map((g) => Array.from(g, (v) => Math.round(v * 100) / 100))]))));
const unsure = Object.values(out).flatMap((r) => r.panels.flatMap((p) => p.rows.flatMap((row) => Object.values(row.stats)))).filter((c) => !c.sure);
console.log(`read ${shots.length} screenshots; ${unsure.length} cells marked unsure`);
