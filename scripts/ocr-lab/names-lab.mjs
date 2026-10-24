// Stats reader lab, step 4: recognising players by the picture of their in-game name
// (public/js/rules/namepics.js), compared with today's text matching.
//
//   node scripts/ocr-lab/names-lab.mjs        (needs ocr-lab/current.json; uses exact.json if there)
//
// Each line is paired with its player by its numbers (as score.mjs does). Then, for every line:
//   - by picture: the line's name picture against pictures of the same players' names from OTHER
//     matches (as it would work for real: learned from earlier matches)
//   - by text: today's matching (the text reader's name vs display name and remembered names)
// A player seen for the first time can't be known by picture yet: counted separately ("new").
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { STAT_ORDER, nameSearchRect, matchNames } from '../../public/js/rules/endscreen.js';
import { namePrint, matchPrints, isNameInk, printSimilarity } from '../../public/js/rules/namepics.js';

const LAB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'ocr-lab');
const current = JSON.parse(readFileSync(join(LAB, 'current.json'), 'utf8'));
let reads = current;
try { reads = JSON.parse(readFileSync(join(LAB, 'exact.json'), 'utf8')); } catch { /* current only */ }
const matches = JSON.parse(readFileSync(join(LAB, 'matches.json'), 'utf8'));
const players = JSON.parse(readFileSync(join(LAB, 'players.json'), 'utf8'));
const val = (c) => (c && typeof c === 'object' ? c.value : c);

// Name ink: the name's letters are bright and/or strongly coloured (green, pink, white...).
async function inkImage(file) {
  const { data, info } = await sharp(readFileSync(join(LAB, 'shots', file))).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const ink = new Uint8Array(info.width * info.height);
  for (let p = 0, i = 0; p < ink.length; p++, i += info.channels) ink[p] = isNameInk(data[i], data[i + 1], data[i + 2]) ? 1 : 0;
  return { ink, width: info.width, height: info.height };
}
function cut(img, rect) {
  const left = Math.max(0, Math.round(rect.left)); const top = Math.max(0, Math.round(rect.top));
  const w = Math.min(img.width - left, Math.round(rect.width)); const h = Math.min(img.height - top, Math.round(rect.height));
  if (w < 4 || h < 4) return null;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) out.set(img.ink.subarray((top + y) * img.width + left, (top + y) * img.width + left + w), y * w);
  return namePrint(out, w, h);
}

const lines = []; // { match, shot, playerId, print, text }
for (const m of matches) {
  const saved = Object.entries(m.saved);
  for (const shot of m.shots) {
    const r = reads[shot];
    if (!r?.layout) continue;
    const img = await inkImage(shot);
    const ls = r.panels.flatMap((p, pi) => p.rows.map((row) => ({ ...row, panel: pi })));
    const pairs = [];
    ls.forEach((l, li) => saved.forEach(([pid, s]) => {
      let same = 0; let n = 0;
      for (const k of STAT_ORDER) if (val(l.stats[k]) != null && s[k] != null) { n++; if (val(l.stats[k]) === s[k]) same++; }
      if (n && same >= Math.min(5, n - 1)) pairs.push({ li, pid, same });
    }));
    pairs.sort((a, b) => b.same - a.same);
    const uL = new Set(); const uP = new Set();
    for (const p of pairs) {
      if (uL.has(p.li) || uP.has(p.pid)) continue;
      uL.add(p.li); uP.add(p.pid);
      const l = ls[p.li];
      lines.push({ match: `${m.eventId}/${m.fixtureId}`, shot, panel: l.panel, row: l.row, playerId: p.pid, print: cut(img, nameSearchRect(r.layout, r.layout.panels[l.panel], l.row)), text: current[shot]?.panels?.[l.panel]?.rows?.find((x) => x.row === l.row)?.name ?? '' });
    }
  }
}

const t = { lines: 0, pic: 0, picWrong: 0, picNone: 0, fresh: 0, text: 0, textWrong: 0 };
const wrong = [];
for (const m of matches) {
  const key = `${m.eventId}/${m.fixtureId}`;
  const here = lines.filter((l) => l.match === key);
  if (!here.length) continue;
  const inMatch = Object.keys(m.saved);
  // Name pictures of these players from other matches only.
  const known = inMatch.map((pid) => ({ playerId: pid, prints: lines.filter((l) => l.match !== key && l.playerId === pid && l.print).map((l) => l.print) })).filter((k) => k.prints.length);
  for (const shot of [...new Set(here.map((l) => l.shot))]) {
    const ls = here.filter((l) => l.shot === shot);
    const byPic = matchPrints(ls.map((l) => l.print), known);
    const byText = matchNames(ls.map((l) => l.text), inMatch.map((pid) => ({ id: pid, names: [players[pid]?.name, ...(players[pid]?.gameNames ?? [])] })));
    ls.forEach((l, i) => {
      t.lines++;
      const isNew = !known.some((k) => k.playerId === l.playerId);
      if (isNew) t.fresh++;
      if (byPic[i].playerId === l.playerId) t.pic++;
      else if (byPic[i].playerId) { t.picWrong++; wrong.push({ shot, should: players[l.playerId]?.name, got: players[byPic[i].playerId]?.name, score: byPic[i].score }); }
      else if (!isNew) t.picNone++;
      if (byText[i].playerId === l.playerId) t.text++;
      else if (byText[i].playerId) t.textWrong++;
    });
  }
}
// How alike: a line's name vs the same player's other pictures, and vs the best OTHER player in
// the match (to set the "clearly theirs" bar from real screenshots).
const own = []; const other = []; const margin = []; const low = [];
for (const l of lines) {
  if (!l.print) continue;
  const m = matches.find((x) => `${x.eventId}/${x.fixtureId}` === l.match);
  const best = (pid) => Math.max(0, ...lines.filter((o) => o.match !== l.match && o.playerId === pid && o.print).map((o) => printSimilarity(l.print, o.print)));
  const s = best(l.playerId);
  if (!s) continue;
  const o = Math.max(0, ...Object.keys(m.saved).filter((pid) => pid !== l.playerId).map(best));
  own.push(s); other.push(o); margin.push(s - o);
  if (s < 0.5) low.push({ s: s.toFixed(2), player: players[l.playerId]?.name, shot: l.shot, panel: l.panel, row: l.row });
}
writeFileSync(join(LAB, 'names-low.json'), JSON.stringify(low, null, 1));
const q = (a, f) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))]?.toFixed(2);
console.log(`own name: min ${q(own, 0)} 5% ${q(own, 0.05)} median ${q(own, 0.5)} | best other player: median ${q(other, 0.5)} 95% ${q(other, 0.95)} max ${q(other, 1)} | margin: min ${q(margin, 0)} 5% ${q(margin, 0.05)}`);
writeFileSync(join(LAB, 'names-wrong.json'), JSON.stringify(wrong, null, 1));
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-');
console.log(`lines with a known player: ${t.lines}; first time that player was seen: ${t.fresh}`);
console.log(`by picture: right ${t.pic} (${pct(t.pic, t.lines - t.fresh)} of players seen before), WRONG ${t.picWrong}, not sure ${t.picNone}`);
console.log(`by text (today): right ${t.text} (${pct(t.text, t.lines)}), WRONG ${t.textWrong}`);
