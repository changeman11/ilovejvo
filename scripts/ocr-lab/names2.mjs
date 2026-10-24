// Stats reader lab, step 5: names by all the evidence together (public/js/rules/whois.js):
//   - the side: each table is one team, so a line chooses between that team's players only
//   - the name's text, read from just the name (nameArea: no title, no badges)
//   - the name's picture, against that player's names in OTHER matches
// Each line is paired with its real player by its numbers (as score.mjs). Reports right / WRONG /
// left to ask ("who's who").
//   node scripts/ocr-lab/names2.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import { STAT_ORDER, nameSearchRect, cleanName } from '../../public/js/rules/endscreen.js';
import { isNameInk, nameArea, namePrint, printToText } from '../../public/js/rules/namepics.js';
import { whoIsWho } from '../../public/js/rules/whois.js';

const LAB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'ocr-lab');
const reads = JSON.parse(readFileSync(join(LAB, 'exact.json'), 'utf8'));
const matches = JSON.parse(readFileSync(join(LAB, 'matches.json'), 'utf8'));
const players = JSON.parse(readFileSync(join(LAB, 'players.json'), 'utf8'));
const val = (c) => (c && typeof c === 'object' ? c.value : c);

const worker = await createWorker('eng', 1);
await worker.setParameters({ tessedit_pageseg_mode: '7' });

// One line's name: its picture, and its text read from just the name (ink black on white, 3×).
async function nameOf(img, info, rect) {
  const sl = Math.max(0, Math.round(rect.left)); const st = Math.max(0, Math.round(rect.top));
  const sw = Math.min(info.width - sl, Math.round(rect.width)); const sh = Math.min(info.height - st, Math.round(rect.height));
  if (sw < 4 || sh < 4) return { print: null, text: '' };
  const ink = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { const i = ((st + y) * info.width + sl + x) * info.channels; ink[y * sw + x] = isNameInk(img[i], img[i + 1], img[i + 2]) ? 1 : 0; }
  const a = nameArea(ink, sw, sh);
  if (!a) return { print: null, text: '' };
  const pad = 2;
  const x0 = Math.max(0, a.x0 - pad); const y0 = Math.max(0, a.y0 - pad);
  const w = Math.min(sw - x0, a.x1 - a.x0 + 1 + 2 * pad); const h = Math.min(sh - y0, a.y1 - a.y0 + 1 + 2 * pad);
  const out = Buffer.alloc(w * h, 255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ink[(y0 + y) * sw + x0 + x]) out[y * w + x] = 0;
  const png = await sharp(out, { raw: { width: w, height: h, channels: 1 } }).resize({ height: h * 3, kernel: 'nearest' }).extend({ top: 12, bottom: 12, left: 12, right: 12, background: { r: 255, g: 255, b: 255 } }).png().toBuffer();
  const { data } = await worker.recognize(png);
  return { print: namePrint(ink, sw, sh), text: data.text.trim() };
}

const lines = [];
for (const m of matches) {
  const saved = Object.entries(m.saved);
  for (const shot of m.shots) {
    const r = reads[shot];
    if (!r?.layout) continue;
    const { data: img, info } = await sharp(readFileSync(join(LAB, 'shots', shot))).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const ls = r.panels.flatMap((p, pi) => p.rows.map((row) => ({ ...row, panel: pi })))
      .filter((l) => Object.values(l.stats).filter((c) => c.why === 'nothing there').length <= Object.keys(l.stats).length / 2);
    const pairs = [];
    ls.forEach((l, li) => saved.forEach(([pid, s]) => {
      let same = 0; let n = 0;
      for (const k of STAT_ORDER) if (val(l.stats[k]) != null && s[k] != null) { n++; if (val(l.stats[k]) === s[k]) same++; }
      if (n && same >= Math.min(5, n - 1)) pairs.push({ li, pid, same });
    }));
    pairs.sort((a, b) => b.same - a.same);
    const truth = new Map(); const uP = new Set();
    for (const p of pairs) { if (truth.has(p.li) || uP.has(p.pid)) continue; truth.set(p.li, p.pid); uP.add(p.pid); }
    for (const [li, l] of ls.entries()) {
      const n = await nameOf(img, info, nameSearchRect(r.layout, r.layout.panels[l.panel], l.row));
      lines.push({ match: `${m.eventId}/${m.fixtureId}`, shot, side: l.panel, row: l.row, truth: truth.get(li) ?? null, ...n });
    }
  }
}
await worker.terminate();

const t = { lines: 0, right: 0, wrong: 0, ask: 0, noTruth: 0 };
const wrong = []; const asked = [];
for (const m of matches) {
  const key = `${m.eventId}/${m.fixtureId}`;
  const teams = {};
  for (const [pid, s] of Object.entries(m.saved)) (teams[s.teamId] ??= []).push(pid);
  for (const shot of m.shots) {
    const ls = lines.filter((l) => l.shot === shot);
    if (!ls.length) continue;
    // What's known about each player: names on the site, and name pictures from OTHER matches.
    const known = Object.fromEntries(Object.keys(m.saved).map((pid) => [pid, {
      names: [players[pid]?.name, ...(players[pid]?.gameNames ?? [])].filter(Boolean),
      prints: lines.filter((o) => o.match !== key && o.truth === pid && o.print).map((o) => o.print),
    }]));
    const out = whoIsWho(ls.map((l) => ({ side: l.side, text: cleanName(l.text) || l.text, print: l.print })), teams, known);
    ls.forEach((l, i) => {
      if (!l.truth) { t.noTruth++; return; }
      t.lines++;
      const got = out[i].playerId;
      if (!got) { t.ask++; asked.push({ shot, row: l.row, side: l.side, text: l.text, should: players[l.truth]?.name }); } else if (got === l.truth) t.right++;
      else { t.wrong++; wrong.push({ shot, row: l.row, side: l.side, text: l.text, why: out[i].why, should: players[l.truth]?.name, got: players[got]?.name }); }
    });
  }
}
// Name pictures for the bot to start with (bot/src/reader/name-prints.json): the newest 6 per
// player, from lines paired with their player by the numbers.
const seed = {};
for (const l of [...lines].reverse()) if (l.truth && l.print && (seed[l.truth] ??= []).length < 6) seed[l.truth].push(printToText(l.print));
writeFileSync(join(LAB, 'name-prints.json'), JSON.stringify(seed));
writeFileSync(join(LAB, 'names2-wrong.json'), JSON.stringify(wrong, null, 1));
writeFileSync(join(LAB, 'names2-ask.json'), JSON.stringify(asked, null, 1));
const pct = (a, b) => `${((100 * a) / b).toFixed(1)}%`;
console.log(`${t.lines} player lines: right ${t.right} (${pct(t.right, t.lines)}), WRONG ${t.wrong}, left to ask ${t.ask} (${pct(t.ask, t.lines)}); ${t.noTruth} lines with no saved player`);
