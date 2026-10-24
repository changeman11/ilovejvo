// Fraud checks on a match's stats before staff publish them (admin /admin/stats). Pure, tested in
// tests/stat-checks.test.mjs. Each check gives a plain-language warning; a match with none can be
// published in one click, one with any is listed for a look first.
//
//   - Unusually high numbers: more per set than all but the top 1% of lines saved so far (learned
//     from the site's own results; DEFAULT_PER_SET until there are enough), with a 20% margin.
//   - Points that don't add up: a team's players' PTS add up to about 89% of the points the team
//     won in the sets, never more than ~113% (80 team-matches, 2026-10-25). Well over = made up.
//   - Changed by hand: a captain (or the player) typed different numbers than the screenshot showed.
//   - Named by hand: a person said whose line it is, and the name on screen doesn't look like theirs.

import { similarity } from './endscreen.js';

// Top 1% per player per set, measured on 312 saved lines (2026-10-25), rounded up.
export const DEFAULT_PER_SET = { pts: 6, spk: 11, blk: 5, rec: 12, set: 10, ast: 3, ace: 2, dig: 6 };
const MIN_HISTORY = 60; // lines needed before the site's own numbers replace the defaults
const MARGIN = 1.2;

// Sets actually played (sets with a score).
export const setsPlayed = (sets) => (sets ?? []).filter((s) => (s?.home ?? 0) + (s?.away ?? 0) > 0).length;

// Per-set "high" for each stat from saved results: history = [{ stats: { pts, ... }, sets }].
export function perSetHighs(history, keys) {
  const rates = Object.fromEntries(keys.map((k) => [k, []]));
  for (const h of history) {
    if (!h.sets) continue;
    for (const k of keys) rates[k].push((Number(h.stats?.[k]) || 0) / h.sets);
  }
  return Object.fromEntries(keys.map((k) => {
    const list = rates[k].sort((a, b) => a - b);
    if (list.length < MIN_HISTORY) return [k, DEFAULT_PER_SET[k] ?? 10];
    return [k, Math.max(1, list[Math.min(list.length - 1, Math.floor(0.99 * list.length))])];
  }));
}

// The most a line can have in `sets` sets before it's flagged.
export const lineLimit = (perSet, k, sets) => Math.max(3, Math.ceil((perSet[k] ?? 10) * Math.max(2, sets) * MARGIN));

// lines: draftSummary lines ({ playerId, teamId, name, stats, editedBy, editedAs, readStats, namedBy })
// ctx: { sets, homeTeamId, awayTeamId, playersById, teamsById, perSet, labels: { pts: 'PTS' } }
// -> [{ kind: 'high' | 'total' | 'edited' | 'named', playerId?, text }]
export function statFlags(lines, { sets, homeTeamId, awayTeamId, playersById = {}, teamsById = {}, perSet = DEFAULT_PER_SET, labels = {} }) {
  const flags = [];
  const n = setsPlayed(sets);
  const label = (k) => labels[k] ?? k.toUpperCase();
  const nameOf = (pid) => playersById[pid]?.displayName ?? pid;
  const byDiscord = (id) => Object.values(playersById).find((p) => String(p.discordId ?? '') === String(id));

  for (const l of lines) {
    // Unusually high numbers.
    const high = Object.entries(l.stats).filter(([k, v]) => Number(v) > lineLimit(perSet, k, n));
    if (high.length) {
      flags.push({ kind: 'high', playerId: l.playerId, text: `${nameOf(l.playerId)}: unusually high ${high.map(([k, v]) => `${label(k)} ${v}`).join(', ')} for ${n} set${n === 1 ? '' : 's'} (normal is up to ${high.map(([k]) => `${lineLimit(perSet, k, n)} ${label(k)}`).join(', ')})` });
    }
    // Changed by hand (staff edits aren't flagged: staff are the ones checking).
    if (l.editedBy && l.editedAs !== 'staff') {
      const editor = byDiscord(l.editedBy);
      const self = l.editedAs === 'self' || (!l.editedAs && editor?.id === l.playerId);
      const who = self ? `${nameOf(l.playerId)} changed their own numbers` : `${l.editedAs === 'captain' ? '👑 Captain ' : ''}${editor?.displayName ?? 'someone else'} changed ${nameOf(l.playerId)}’s numbers`;
      const changes = l.readStats
        ? Object.keys(l.stats).filter((k) => l.readStats[k] != null && Number(l.readStats[k]) !== Number(l.stats[k])).map((k) => `${label(k)} ${l.readStats[k]}→${l.stats[k]}`)
        : null;
      if (!changes) flags.push({ kind: 'edited', playerId: l.playerId, text: `${who} (the screenshot’s numbers weren’t kept: compare with it)` });
      else if (changes.length) flags.push({ kind: 'edited', playerId: l.playerId, text: `${who}: ${changes.join(', ')}` });
    }
    // Named by hand, and the name on screen doesn't look like theirs.
    if (l.namedBy && l.name) {
      const p = playersById[l.playerId];
      const like = Math.max(0, ...[p?.displayName, ...(p?.gameNames ?? [])].filter(Boolean).map((x) => similarity(l.name, x)));
      if (like < 0.5) {
        const by = byDiscord(l.namedBy);
        flags.push({ kind: 'named', playerId: l.playerId, text: `“${l.name}” on screen was named as ${nameOf(l.playerId)}${by ? ` by ${by.id === l.playerId ? 'themself' : by.displayName}` : ''} in Who’s who` });
      }
    }
  }

  // Points that don't add up: more PTS than the team won (a couple over is normal).
  const won = {
    [homeTeamId]: (sets ?? []).reduce((s, x) => s + (Number(x?.home) || 0), 0),
    [awayTeamId]: (sets ?? []).reduce((s, x) => s + (Number(x?.away) || 0), 0),
  };
  for (const teamId of [homeTeamId, awayTeamId]) {
    const pts = lines.filter((l) => l.teamId === teamId).reduce((s, l) => s + (Number(l.stats.pts) || 0), 0);
    if (won[teamId] && pts > Math.ceil(won[teamId] * 1.15) + 1) {
      flags.push({ kind: 'total', text: `${teamsById[teamId]?.name ?? 'A team'}’s players have ${pts} ${label('pts')} between them, but the team only won ${won[teamId]} points` });
    }
  }
  return flags;
}
