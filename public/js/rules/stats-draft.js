// Stats from a match's screenshot reading (result.statsDraft, made by stats-reader.js and
// confirmed or fixed by players in the Discord match thread), ready for staff to submit.
// Pure functions, no Firebase (tests/stats-draft.test.mjs).

import { cleanStatLine } from './results.js';

// Which of the two teams a player played for: their club, or the event roster (mix teams).
export function teamOf(playerId, { homeTeamId, awayTeamId, playersById, rosters }) {
  const club = playersById[playerId]?.teamId;
  if (club === homeTeamId || club === awayTeamId) return club;
  for (const t of [homeTeamId, awayTeamId]) if (rosters?.[t]?.playerIds?.includes(playerId)) return t;
  return null;
}

// The reading as it stands, for staff:
//   { lines: [{ playerId, teamId, name, stats: { pts: n, ... }, confirmed, edited, unsure }],
//     unknown: [names nobody has been matched to], offTeam: [players not on either team],
//     confirmed, total }
export function draftSummary(result, ctx, statKeys) {
  const rows = result?.statsDraft?.rows ?? [];
  const lines = [];
  const unknown = [];
  const offTeam = [];
  for (const r of rows) {
    if (r.notPlayer) continue;
    if (!r.playerId) {
      const scored = Object.values(r.stats ?? {}).some((c) => Number(c?.value) > 0);
      if (r.name && (String(r.name).length >= 3 || scored)) unknown.push(r.name);
      continue;
    }
    const teamId = teamOf(r.playerId, ctx);
    if (!teamId) { offTeam.push(r.playerId); continue; }
    lines.push({
      playerId: r.playerId,
      teamId,
      name: r.name ?? '',
      stats: Object.fromEntries(statKeys.map((k) => [k, r.stats?.[k]?.value ?? null])),
      confirmed: Boolean(r.confirmedBy),
      edited: Boolean(r.editedBy),
      unsure: !r.confirmedBy && statKeys.some((k) => r.stats?.[k] && r.stats[k].sure === false),
    });
  }
  return { lines, unknown, offTeam, confirmed: lines.filter((l) => l.confirmed).length, total: lines.length };
}

// The playerStats to save ({ playerId: { teamId, pts, ... } }). Missing numbers count as 0.
export function playerStatsFromDraft(summary, statKeys) {
  return Object.fromEntries(summary.lines.map((l) => [l.playerId, { teamId: l.teamId, ...cleanStatLine(l.stats, statKeys) }]));
}
