// Season-wide helpers: which format a match uses, and every finished match
// (regular season + playoffs) for stats, records and awards.
// Pure functions, no Firebase.

import { DEFAULT_FORMAT } from './defaults.js';
import { finishedMatches } from './standings.js';

export const isPlayoff = (fixture) => fixture?.stage === 'playoffs';

// The match format for one fixture.
// A fixture can set its own `bestOf` (e.g. a best-of-5 final in a tournament);
// league playoff rounds can override best-of and set targets.
export function formatFor(season, fixture) {
  const base = season?.format ?? DEFAULT_FORMAT;
  if (fixture?.bestOf) return { ...base, bestOf: fixture.bestOf };
  if (!isPlayoff(fixture)) return base;
  const round = season?.playoffs?.rounds?.find((r) => r.id === fixture.playoffRound);
  if (!round) return base;
  return {
    ...base,
    bestOf: round.bestOf ?? base.bestOf,
    pointsPerSet: round.pointsPerSet ?? base.pointsPerSet,
    decidingSetPoints: round.decidingSetPoints ?? base.decidingSetPoints,
  };
}

// Every checked, finished match in the season (regular + playoffs), oldest first.
// JVO counts playoff games in stats, leaders, awards and records.
export function seasonMatches({ season, fixtures, results }) {
  return finishedMatches(fixtures, results, (f) => formatFor(season, f));
}

// "Round 7", or the playoff round's name ("Grand final" / short "GF").
export function roundLabel(season, fixture, { short = false } = {}) {
  if (isPlayoff(fixture)) {
    const round = season?.playoffs?.rounds?.find((r) => r.id === fixture.playoffRound);
    if (round) return short ? round.short ?? round.name : round.name;
    return short ? 'PO' : 'Playoffs';
  }
  return short ? `R${fixture.round}` : `Round ${fixture.round}`;
}
