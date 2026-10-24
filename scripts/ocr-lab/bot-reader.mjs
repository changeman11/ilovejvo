// Stats reader lab, step 6: the BOT's reader end to end (bot/src/stats-read.js + logic/reading.js),
// exactly as it runs on the server, on every collected screenshot. Compares with the lab readings
// (exact.json, checked by eye) and the saved players.
//   node scripts/ocr-lab/bot-reader.mjs [--no-prints]
//
// Copy the learned files into the bot first:
//   ocr-lab/templates.json -> bot/src/reader/digits.json, ocr-lab/name-prints.json -> bot/src/reader/name-prints.json
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ShotReader } from '../../bot/src/stats-read.js';
import { placeLines, knownPrints } from '../../bot/src/logic/reading.js';
import { STAT_ORDER } from '../../public/js/rules/endscreen.js';

const LAB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'ocr-lab');
const exact = JSON.parse(readFileSync(join(LAB, 'exact.json'), 'utf8'));
const matches = JSON.parse(readFileSync(join(LAB, 'matches.json'), 'utf8'));
const players = JSON.parse(readFileSync(join(LAB, 'players.json'), 'utf8'));
const noPrints = process.argv.includes('--no-prints');
const reader = new ShotReader({ cachePath: join(LAB, 'tess'), ...(noPrints ? { seedPrints: {} } : {}) });
const val = (c) => (c && typeof c === 'object' ? c.value : c);

const t = { shots: 0, failed: 0, lines: 0, labLines: 0, cells: 0, differ: 0, unsure: 0, right: 0, wrong: 0, ask: 0 };
const notes = [];
for (const m of matches) {
  const homeTeamId = Object.values(m.saved)[0]?.teamId;
  const squads = {};
  for (const [pid, s] of Object.entries(m.saved)) (squads[s.teamId] ??= []).push({ id: pid, displayName: players[pid]?.name, gameNames: players[pid]?.gameNames ?? [] });
  const awayTeamId = Object.keys(squads).find((x) => x !== homeTeamId);
  for (const shot of m.shots) {
    if (!exact[shot]?.layout) continue;
    t.shots++;
    const out = await reader.read(readFileSync(join(LAB, 'shots', shot)));
    if (out.error) { t.failed++; notes.push(`${shot}: ${out.error}`); continue; }
    // The lab's lines for this shot (real lines only).
    const labLines = exact[shot].panels.flatMap((p, side) => p.rows.map((r) => ({ ...r, side })))
      .filter((l) => Object.values(l.stats).filter((c) => c.why === 'nothing there').length <= Object.keys(l.stats).length / 2);
    t.labLines += labLines.length;
    t.lines += out.lines.length;
    for (const l of out.lines) {
      const lab = labLines.find((x) => x.side === l.side && x.row === l.row);
      for (const k of STAT_ORDER) {
        if (!l.stats[k]) continue;
        t.cells++;
        if (!l.stats[k].sure) t.unsure++;
        if (lab && val(lab.stats[k]) !== l.stats[k].value) { t.differ++; notes.push(`${shot} ${l.side}/${l.row} ${k}: bot ${l.stats[k].value}, lab ${val(lab.stats[k])}`); }
      }
    }
    // Names, against the saved player each line's numbers belong to.
    const rows = placeLines(out.lines, { homeTeamId, awayTeamId, homeSquad: squads[homeTeamId] ?? [], awaySquad: squads[awayTeamId] ?? [], prints: knownPrints(reader.seedPrints) });
    rows.forEach((r, i) => {
      const l = out.lines[i];
      let truth = null; let best = 0;
      for (const [pid, s] of Object.entries(m.saved)) {
        const same = STAT_ORDER.filter((k) => l.stats[k] && s[k] === l.stats[k].value).length;
        if (same > best) { best = same; truth = pid; }
      }
      if (best < 5) return;
      if (!r.playerId) t.ask++;
      else if (r.playerId === truth) t.right++;
      else { t.wrong++; notes.push(`${shot} ${l.side}/${l.row} "${l.nameText}": given ${players[r.playerId]?.name}, is ${players[truth]?.name} (${r.matchedBy})`); }
    });
  }
}
await reader.close();
console.log(notes.join('\n'));
console.log(`${t.shots} screenshots (${t.failed} not read), ${t.lines} lines (lab ${t.labLines}); ${t.cells} numbers: ${t.differ} differ from the lab, ${t.unsure} unsure`);
console.log(`names${noPrints ? ' (no stored pictures)' : ''}: right ${t.right}, WRONG ${t.wrong}, ask ${t.ask}`);
