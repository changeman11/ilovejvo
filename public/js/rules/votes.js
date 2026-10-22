// Result votes: after a match, any player on either team submits the set scores (their vote on
// who won and by how much) plus their own team's stat lines. When a player from each team has
// submitted the SAME set scores, the result is agreed and goes live; the two teams' stat lines are
// combined. Pure functions, no Firebase. firestore.rules checks the same agreement on save.

import { checkResult } from './match.js';
import { suggestMvp } from './results.js';

export const sameSets = (a = [], b = []) => a.length === b.length
  && a.every((s, i) => Number(s.home) === Number(b[i].home) && Number(s.away) === Number(b[i].away));

const newestFirst = (x, y) => (y.updatedAt ?? 0) - (x.updatedAt ?? 0);

// Only the lines for the submitter's own team (players vouch for their own team's stats).
export const ownTeamLines = (playerStats, teamId) => Object.fromEntries(
  Object.entries(playerStats ?? {}).filter(([, line]) => line?.teamId === teamId),
);

// subs: the submissions for one fixture [{ id, teamId, sets, playerStats, updatedAt, playerId }]
// Returns {
//   status: 'none' | 'waiting' (only one team has voted) | 'agreed' | 'disputed' (both voted, no matching scores),
//   home: [...], away: [...] (newest first), pair: { home, away } when agreed
// }
export function tallyVotes(subs, fixture) {
  const home = subs.filter((s) => s.teamId === fixture.homeTeamId).sort(newestFirst);
  const away = subs.filter((s) => s.teamId === fixture.awayTeamId).sort(newestFirst);
  if (!home.length && !away.length) return { status: 'none', home, away, pair: null };
  if (!home.length || !away.length) return { status: 'waiting', home, away, pair: null };
  for (const h of home) {
    for (const a of away) {
      if (sameSets(h.sets, a.sets)) return { status: 'agreed', home, away, pair: { home: h, away: a } };
    }
  }
  return { status: 'disputed', home, away, pair: null };
}

// The result to publish for an agreed pair: their scores, both teams' stat lines, the suggested MVP.
// Returns null if the pair can't be combined (e.g. the scores don't make a valid match).
export function resultFromVotes(pair, fixture, format) {
  if (!pair || !sameSets(pair.home.sets, pair.away.sets)) return null;
  const sets = pair.home.sets.map((s) => ({ home: Number(s.home), away: Number(s.away) }));
  const check = checkResult(sets, format);
  if (!check.ok) return null;
  const homeLines = ownTeamLines(pair.home.playerStats, fixture.homeTeamId);
  const awayLines = ownTeamLines(pair.away.playerStats, fixture.awayTeamId);
  const playerStats = { ...homeLines, ...awayLines };
  const winnerTeamId = check.winner === 'home' ? fixture.homeTeamId : fixture.awayTeamId;
  return {
    sets,
    playerStats,
    mvpPlayerId: suggestMvp(playerStats, winnerTeamId),
    forfeit: null,
    confirmedBy: [pair.home.id, pair.away.id],
    source: 'votes',
  };
}

// Describes one vote for display, e.g. "2–1 (10–7, 8–10, 12–10)".
export function voteLabel(sets) {
  let h = 0;
  let a = 0;
  for (const s of sets ?? []) {
    if (Number(s.home) > Number(s.away)) h++;
    else a++;
  }
  return `${h}–${a} (${(sets ?? []).map((s) => `${s.home}–${s.away}`).join(', ')})`;
}
