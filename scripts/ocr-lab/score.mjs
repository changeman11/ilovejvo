// Stats reader lab: score a reader's output against the stats staff saved (and, where they
// disagree, against the answers checked by eye in ocr-lab/checked.json).
//
//   node scripts/ocr-lab/score.mjs current        (reads ocr-lab/current.json)
//   node scripts/ocr-lab/score.mjs exact          (reads ocr-lab/exact.json)
//
// Each read line is paired with the saved player it agrees with most (so one wrong number doesn't
// break the pairing). Writes ocr-lab/<name>-diffs.json: every cell where reader and saved disagree.
// checked.json: { "<shot>|<panel>|<row>|<stat>": <the right number, checked on the screenshot> }
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAT_ORDER, matchNames } from '../../public/js/rules/endscreen.js';

const LAB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'ocr-lab');
const which = process.argv[2] ?? 'current';
const reads = JSON.parse(readFileSync(join(LAB, `${which}.json`), 'utf8'));
const matches = JSON.parse(readFileSync(join(LAB, 'matches.json'), 'utf8'));
const players = JSON.parse(readFileSync(join(LAB, 'players.json'), 'utf8'));
const checked = existsSync(join(LAB, 'checked.json')) ? JSON.parse(readFileSync(join(LAB, 'checked.json'), 'utf8')) : {};
const val = (c) => (c && typeof c === 'object' ? c.value : c);

const t = { shots: 0, noTable: 0, notEndScreen: [], lines: 0, paired: 0, cells: 0, agree: 0, disagree: 0, rightByEye: 0, wrongByEye: 0, unchecked: 0, names: 0, namesRight: 0, missingLines: 0 };
const diffs = [];
for (const m of matches) {
  const saved = Object.entries(m.saved);
  for (const shot of m.shots) {
    const r = reads[shot];
    if (!r) continue;
    t.shots++;
    if (r.error || !r.panels) { t.noTable++; t.notEndScreen.push(`${shot} (${r.error})`); continue; }
    const lines = r.panels.flatMap((p, pi) => p.rows.map((row) => ({ ...row, panel: pi })));
    t.lines += lines.length;
    // Pair read lines with saved players: most equal cells first.
    const pairs = [];
    lines.forEach((l, li) => saved.forEach(([pid, s]) => {
      let same = 0;
      let n = 0;
      for (const k of STAT_ORDER) if (val(l.stats[k]) != null && s[k] != null) { n++; if (val(l.stats[k]) === s[k]) same++; }
      if (n && same >= Math.min(4, n - 1)) pairs.push({ li, pid, same });
    }));
    pairs.sort((a, b) => b.same - a.same);
    const usedL = new Set();
    const usedP = new Set();
    const paired = [];
    for (const p of pairs) {
      if (usedL.has(p.li) || usedP.has(p.pid)) continue;
      usedL.add(p.li); usedP.add(p.pid); paired.push(p);
    }
    t.paired += paired.length;
    t.missingLines += saved.length - paired.length;
    // Names: does the line's name pick the right player among this match's players?
    const candidates = saved.map(([pid]) => ({ id: pid, names: [players[pid]?.name, ...(players[pid]?.gameNames ?? [])] }));
    const named = matchNames(lines.map((l) => l.name ?? ''), candidates);
    for (const p of paired) {
      const l = lines[p.li];
      t.names++;
      if (named[p.li].playerId === p.pid) t.namesRight++;
      const s = m.saved[p.pid];
      for (const k of STAT_ORDER) {
        const got = val(l.stats[k]);
        if (got == null || s[k] == null) continue;
        t.cells++;
        const key = `${shot}|${l.panel}|${l.row}|${k}`;
        const truth = key in checked ? checked[key] : null;
        if (got === s[k] && truth == null) { t.agree++; continue; }
        if (truth != null) { if (got === truth) t.rightByEye++; else t.wrongByEye++; if (got === s[k]) t.agree++; else t.disagree++; continue; }
        t.disagree++;
        t.unchecked++;
        diffs.push({ key, shot, panel: l.panel, row: l.row, stat: k, read: got, saved: s[k], player: players[p.pid]?.name });
      }
    }
  }
}
writeFileSync(join(LAB, `${which}-diffs.json`), JSON.stringify(diffs, null, 1));
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-');
console.log(`${which}: ${t.shots} screenshots, ${t.noTable} with no table found`);
for (const s of t.notEndScreen) console.log(`   no table: ${s}`);
console.log(`lines read ${t.lines}; paired with a saved player ${t.paired}; saved players with no line found ${t.missingLines}`);
console.log(`numbers: ${t.cells} cells; same as saved ${t.agree} (${pct(t.agree, t.cells)}); different ${t.disagree} (${t.unchecked} not checked by eye yet)`);
if (t.rightByEye + t.wrongByEye) console.log(`checked by eye: reader right ${t.rightByEye}, wrong ${t.wrongByEye}`);
console.log(`names: right player picked for ${t.namesRight} of ${t.names} lines (${pct(t.namesRight, t.names)})`);
