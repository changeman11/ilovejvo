// Who each line of the end-of-match screen is, from all the evidence together. Pure (tested in
// tests/whois.test.mjs); used by the bot's stats reader and the lab (scripts/ocr-lab/names2.mjs).
//
//   - Sides: each table (left / right) is one team, so a line only chooses between that team's
//     players. Which team is which side is worked out from the names themselves.
//   - Text: the name read from just the name (no title, no badges), against the player's site name
//     and the in-game names they've been known by.
//   - Picture: the name's picture against that player's earlier ones (rules/namepics.js).
//   - Elimination: when one line on a side is left and one player of that team is left.
// A line is only given a player when the evidence is clearly theirs; the rest are left for players
// to answer ("who's who" in the match thread). Being unsure is fine; being wrong isn't.
//
// lines: [{ side: 0|1, text, print }]
// teams: { teamId: [playerId] } the two teams' players who could have played
// known: { playerId: { names: [string], prints: [print] } }
// -> [{ playerId|null, score, why }] in line order

import { similarity } from './endscreen.js';
import { printSimilarity } from './namepics.js';

export const WHOIS = { text: 0.75, picture: 0.62, margin: 0.12 };

function evidence(line, pid, known) {
  const k = known[pid] ?? { names: [], prints: [] };
  const text = Math.max(0, ...k.names.map((n) => similarity(line.text, n)));
  const picture = Math.max(0, ...k.prints.map((p) => printSimilarity(line.print, p)));
  // Scaled so either kind passing its bar scores at least 1.
  const score = Math.max(text / WHOIS.text, picture / WHOIS.picture);
  return { score, text, picture };
}

export function whoIsWho(lines, teams, known) {
  const teamIds = Object.keys(teams);
  const out = lines.map(() => ({ playerId: null, score: 0, why: null }));
  if (!lines.length || !teamIds.length) return out;

  // Which team is on which side: the way round where the names fit best.
  const fit = (sideTeam) => lines.reduce((sum, l) => sum + Math.min(1.5, Math.max(0, ...(teams[sideTeam[l.side]] ?? []).map((pid) => evidence(l, pid, known).score))), 0);
  const a = { 0: teamIds[0], 1: teamIds[1] };
  const b = { 0: teamIds[1], 1: teamIds[0] };
  const sideTeam = teamIds.length < 2 || fit(a) >= fit(b) ? a : b;

  for (const side of [0, 1]) {
    const idx = lines.map((l, i) => (l.side === side ? i : -1)).filter((i) => i >= 0);
    const candidates = teams[sideTeam[side]] ?? [];
    if (!idx.length || !candidates.length) continue;
    // Best and second-best player for each line.
    const pairs = [];
    for (const i of idx) {
      const scored = candidates.map((pid) => ({ pid, ...evidence(lines[i], pid, known) })).sort((x, y) => y.score - x.score);
      const [first, second] = scored;
      if (first && first.score >= 1 && first.score - (second?.score ?? 0) >= WHOIS.margin / WHOIS.text) {
        pairs.push({ i, pid: first.pid, score: first.score, why: first.picture / WHOIS.picture >= first.text / WHOIS.text ? 'picture' : 'text' });
      }
    }
    pairs.sort((x, y) => y.score - x.score);
    const used = new Set();
    for (const p of pairs) {
      if (out[p.i].playerId || used.has(p.pid)) continue;
      out[p.i] = { playerId: p.pid, score: p.score, why: p.why };
      used.add(p.pid);
    }
    // One line left and one player of that team left: it's them.
    const openLines = idx.filter((i) => !out[i].playerId);
    const openPlayers = candidates.filter((pid) => !used.has(pid));
    if (openLines.length === 1 && openPlayers.length === 1) out[openLines[0]] = { playerId: openPlayers[0], score: 1, why: 'the only one left' };
  }
  return out;
}
