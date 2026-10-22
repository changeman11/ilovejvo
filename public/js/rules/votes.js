// Result votes: after a match, any player on either team submits the set scores (their vote on
// who won and by how much) plus end-of-match screenshots. When a player from each team has
// submitted the SAME set scores, the SCORE goes live straight away (so tournaments keep moving).
// Player stats come later: an admin reads them from the screenshots and checks them
// (statsStatus 'pending' -> 'reviewed'). Pure functions, no Firebase. firestore.rules checks the
// same agreement on save.

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

// The score to publish for an agreed pair. Stats and MVP are added by an admin later.
// Returns null if the scores don't make a valid match.
export function resultFromVotes(pair, fixture, format) {
  if (!pair || !sameSets(pair.home.sets, pair.away.sets)) return null;
  const sets = pair.home.sets.map((s) => ({ home: Number(s.home), away: Number(s.away) }));
  if (!checkResult(sets, format).ok) return null;
  return {
    sets,
    playerStats: {},
    mvpPlayerId: null,
    forfeit: null,
    confirmedBy: [pair.home.id, pair.away.id],
    source: 'votes',
    statsStatus: 'pending',
  };
}

// The MVP for stats an admin has entered (top scorer on the winning team).
export function mvpFor(result, fixture, format) {
  const check = checkResult(result.sets, format);
  if (!check.ok) return null;
  return suggestMvp(result.playerStats, check.winner === 'home' ? fixture.homeTeamId : fixture.awayTeamId);
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
