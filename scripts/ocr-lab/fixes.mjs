// Stats reader lab, step 7: which SAVED stats on the site are wrong, by the bot's reader.
// Run collect.mjs first (fresh copy of the site). For every match with saved stats and screenshots:
// each read line is paired with its player (by name AND by numbers: both must agree, or the line is
// left out), and every number the reader is sure of that differs from the saved one is a fix.
// Numbers checked by eye (checked.json) win over the reader.
//   node scripts/ocr-lab/fixes.mjs   -> ocr-lab/fixes.json, ocr-lab/fixes-skipped.json
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ShotReader } from '../../bot/src/stats-read.js';
import { placeLines, knownPrints } from '../../bot/src/logic/reading.js';
import { STAT_ORDER } from '../../public/js/rules/endscreen.js';

const LAB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'ocr-lab');
const matches = JSON.parse(readFileSync(join(LAB, 'matches.json'), 'utf8'));
const players = JSON.parse(readFileSync(join(LAB, 'players.json'), 'utf8'));
const checked = existsSync(join(LAB, 'checked.json')) ? JSON.parse(readFileSync(join(LAB, 'checked.json'), 'utf8')) : {};
const cacheFile = join(LAB, 'bot-reads.json');
const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {};
const reader = new ShotReader({ cachePath: join(LAB, 'tess') });

const fixes = []; const skipped = [];
for (const m of matches) {
  if (!Object.keys(m.saved).length) continue;
  const teams = {};
  for (const [pid, s] of Object.entries(m.saved)) (teams[s.teamId] ??= []).push({ id: pid, displayName: players[pid]?.name, gameNames: players[pid]?.gameNames ?? [] });
  const [homeTeamId, awayTeamId] = Object.keys(teams);
  const found = {}; // playerId -> stat -> { value, shot }
  for (const shot of m.shots) {
    cache[shot] ??= await reader.read(readFileSync(join(LAB, 'shots', shot)));
    const out = cache[shot];
    if (out.error) { skipped.push({ match: `${m.eventId}/${m.fixtureId}`, shot, why: out.error }); continue; }
    const rows = placeLines(out.lines, { homeTeamId, awayTeamId, homeSquad: teams[homeTeamId] ?? [], awaySquad: teams[awayTeamId] ?? [], prints: knownPrints(reader.seedPrints) });
    out.lines.forEach((l, i) => {
      // Paired by numbers: the saved player most of its numbers match (5 of 8 at least).
      let byNums = null; let best = 0;
      for (const [pid, s] of Object.entries(m.saved)) {
        const same = STAT_ORDER.filter((k) => l.stats[k] && s[k] === l.stats[k].value).length;
        if (same > best) { best = same; byNums = pid; }
      }
      const byName = rows[i].playerId;
      const pid = best >= 5 && (!byName || byName === byNums) ? byNums : null;
      if (!pid) {
        skipped.push({ match: `${m.eventId}/${m.fixtureId}`, shot, line: `${l.side}/${l.row}`, name: l.nameText, why: byName && byNums && byName !== byNums ? `name says ${players[byName]?.name}, numbers say ${players[byNums]?.name}` : `numbers don’t clearly match anyone (${best} of 8)` });
        return;
      }
      for (const k of STAT_ORDER) {
        const c = l.stats[k];
        if (!c) continue;
        const truth = checked[`${shot}|${l.side}|${l.row}|${k}`];
        const value = truth !== undefined ? truth : c.sure ? c.value : null;
        if (value == null) continue;
        const prev = found[pid]?.[k];
        if (prev && prev.value !== value) { skipped.push({ match: `${m.eventId}/${m.fixtureId}`, player: players[pid]?.name, stat: k, why: `two screenshots disagree (${prev.value} / ${value})` }); continue; }
        (found[pid] ??= {})[k] = { value, shot, byEye: truth !== undefined };
      }
    });
  }
  for (const [pid, stats] of Object.entries(found)) {
    for (const [k, r] of Object.entries(stats)) {
      const saved = m.saved[pid][k] ?? 0;
      if (saved !== r.value) fixes.push({ eventId: m.eventId, fixtureId: m.fixtureId, match: `${m.home} v ${m.away}`, playerId: pid, player: players[pid]?.name, stat: k, saved, read: r.value, byEye: r.byEye, shot: r.shot });
    }
  }
}
await reader.close();
writeFileSync(cacheFile, JSON.stringify(cache));
writeFileSync(join(LAB, 'fixes.json'), JSON.stringify(fixes, null, 1));
writeFileSync(join(LAB, 'fixes-skipped.json'), JSON.stringify(skipped, null, 1));
for (const f of fixes) console.log(`${f.match} · ${f.player} · ${f.stat}: saved ${f.saved} → ${f.read}${f.byEye ? ' (checked by eye)' : ''}`);
console.log(`${fixes.length} numbers to fix in ${new Set(fixes.map((f) => f.fixtureId)).size} matches; ${skipped.length} lines/numbers left out (fixes-skipped.json)`);
