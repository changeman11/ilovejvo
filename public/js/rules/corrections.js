// Result fixes (added 2026-10-25): after a score is in (often from a Discord match thread), a
// player on either team can send a fix: the right set scores, screenshots that were never posted,
// and/or a note for the admins. Saved as events/{e}/corrections/{fixtureId}__{playerId}.
//
// When one home-team fix and one away-team fix give the same new set scores, the score is changed
// straight away (the browser saves it with the second fix; firestore.rules agreedCorrection checks
// it). Everything else (one-sided fixes, screenshots, notes) goes to the admins' to-do list.
// Pure functions, no Firebase.

import { sameSets } from './votes.js';

// A fix still needs someone: not closed by an admin, and not just a score fix that's already applied.
export function fixPending(c, result) {
  if (!c || (c.status ?? 'open') !== 'open') return false;
  const scoreDone = !c.sets?.length || (result && sameSets(c.sets, result.sets));
  const extras = (c.screenshotPaths?.length ?? 0) > 0 || Boolean(c.note?.trim());
  return !scoreDone || extras;
}

// One match's fixes: { home: [...], away: [...], pending: [...] }, newest first.
export function fixesFor(corrections, fixture, result) {
  const mine = (corrections ?? []).filter((c) => c.fixtureId === fixture.id)
    .sort((x, y) => (y.updatedAt ?? 0) - (x.updatedAt ?? 0));
  return {
    home: mine.filter((c) => c.teamId === fixture.homeTeamId),
    away: mine.filter((c) => c.teamId === fixture.awayTeamId),
    pending: mine.filter((c) => fixPending(c, result)),
  };
}

// With my fix saved, does the other team have an open fix with the same new score (and is it
// actually a change)? Returns that fix, or null.
export function agreeingFix({ corrections, fixture, result, mine }) {
  if (!mine?.sets?.length || !result || result.forfeit) return null;
  if (sameSets(mine.sets, result.sets)) return null;
  const otherTeam = mine.teamId === fixture.homeTeamId ? fixture.awayTeamId : fixture.homeTeamId;
  return (corrections ?? [])
    .filter((c) => c.fixtureId === fixture.id && c.teamId === otherTeam && (c.status ?? 'open') === 'open' && c.sets?.length)
    .sort((x, y) => (y.updatedAt ?? 0) - (x.updatedAt ?? 0))
    .find((c) => sameSets(c.sets, mine.sets)) ?? null;
}

// The result update for an agreed fix: only the sets change (stats stay, the table and podiums
// are worked out again from the new score). correctedBy = [home fix id, away fix id].
export function correctedResult({ fixture, mine, other }) {
  const [home, away] = mine.teamId === fixture.homeTeamId ? [mine, other] : [other, mine];
  return { sets: mine.sets.map((s) => ({ home: Number(s.home), away: Number(s.away) })), correctedBy: [home.id, away.id] };
}

// What the other team's captain can agree to with one tap: their open score fixes that differ from
// the result and from what this team already sent.
export function fixesToAgree({ corrections, fixture, result, teamId }) {
  const ours = (corrections ?? []).filter((c) => c.fixtureId === fixture.id && c.teamId === teamId && c.sets?.length);
  const seen = [];
  return (corrections ?? []).filter((c) => {
    if (c.fixtureId !== fixture.id || c.teamId === teamId || (c.status ?? 'open') !== 'open' || !c.sets?.length) return false;
    if (result && sameSets(c.sets, result.sets)) return false;
    if (ours.some((o) => sameSets(o.sets, c.sets)) || seen.some((s) => sameSets(s, c.sets))) return false;
    seen.push(c.sets);
    return true;
  });
}
