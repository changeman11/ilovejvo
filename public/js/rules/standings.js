// Standings: built from fixtures + results every time. Nothing here is stored.
// Pure functions, no Firebase, so they run in the browser and in tests.

import { DEFAULT_FORMAT, DEFAULT_STANDINGS } from './defaults.js';
import { checkResult } from './match.js';

// Table points a team gets for a set score, e.g. (2, 1) -> 2
export function matchPointsFor(setsWon, setsLost, standingsRules = DEFAULT_STANDINGS) {
  return standingsRules.matchPoints[`${setsWon}-${setsLost}`] ?? 0;
}

// Won/lost ratio. No losses but some wins = Infinity (shown as "MAX").
export function ratio(won, lost) {
  if (lost === 0) return won === 0 ? 0 : Infinity;
  return won / lost;
}

function emptyRow(team) {
  return {
    teamId: team.id,
    name: team.name,
    shortName: team.shortName ?? team.name,
    played: 0,
    wins: 0,
    losses: 0,
    points: 0,
    setsWon: 0,
    setsLost: 0,
    pointsWon: 0,
    pointsLost: 0,
    setRatio: 0,
    pointRatio: 0,
    form: [], // oldest first; last 5 kept
  };
}

// Turns fixtures + results into the list of finished matches, oldest first.
// Results that don't pass the rules are returned in `problems` instead.
export function finishedMatches(fixtures, resultsById, format = DEFAULT_FORMAT) {
  const matches = [];
  const problems = [];
  const ordered = [...fixtures].sort(
    (a, b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0) || (a.round ?? 0) - (b.round ?? 0)
  );
  for (const fx of ordered) {
    const result = resultsById[fx.id];
    if (!result) continue;
    const check = checkResult(result.sets, format);
    if (!check.ok) {
      problems.push({ fixtureId: fx.id, errors: check.errors });
      continue;
    }
    matches.push({
      fixtureId: fx.id,
      round: fx.round,
      scheduledAt: fx.scheduledAt,
      homeTeamId: fx.homeTeamId,
      awayTeamId: fx.awayTeamId,
      ...check,
    });
  }
  return { matches, problems };
}

function addMatch(row, mine, theirs, myPoints, theirPoints, rules, fixtureId) {
  row.played++;
  const won = mine > theirs;
  if (won) row.wins++;
  else row.losses++;
  row.points += matchPointsFor(mine, theirs, rules);
  row.setsWon += mine;
  row.setsLost += theirs;
  row.pointsWon += myPoints;
  row.pointsLost += theirPoints;
  row.form.push({ result: won ? 'W' : 'L', score: `${mine}-${theirs}`, fixtureId });
}

function tally(teams, matches, rules) {
  const rows = new Map(teams.map((t) => [t.id, emptyRow(t)]));
  for (const m of matches) {
    const home = rows.get(m.homeTeamId);
    const away = rows.get(m.awayTeamId);
    if (home) addMatch(home, m.homeSets, m.awaySets, m.homePoints, m.awayPoints, rules, m.fixtureId);
    if (away) addMatch(away, m.awaySets, m.homeSets, m.awayPoints, m.homePoints, rules, m.fixtureId);
  }
  for (const row of rows.values()) {
    row.setRatio = ratio(row.setsWon, row.setsLost);
    row.pointRatio = ratio(row.pointsWon, row.pointsLost);
  }
  return rows;
}

// Each tiebreaker gives a number per team; higher is better.
const CRITERIA = {
  points: (row) => row.points,
  wins: (row) => row.wins,
  setRatio: (row) => row.setRatio,
  pointRatio: (row) => row.pointRatio,
  setDiff: (row) => row.setsWon - row.setsLost,
  pointDiff: (row) => row.pointsWon - row.pointsLost,
  setsWon: (row) => row.setsWon,
};

// Sorts a group of tied teams by the remaining tiebreakers, one at a time.
// "h2h" builds a mini-table from only the matches between the tied teams.
function sortGroup(group, criteria, ctx) {
  if (group.length <= 1) return group;
  if (criteria.length === 0) {
    return [...group].sort((a, b) => a.name.localeCompare(b.name));
  }
  const [first, ...rest] = criteria;
  let score;
  if (first === 'h2h') {
    const ids = new Set(group.map((r) => r.teamId));
    const between = ctx.matches.filter((m) => ids.has(m.homeTeamId) && ids.has(m.awayTeamId));
    const mini = tally(group.map((r) => ({ id: r.teamId, name: r.name })), between, ctx.rules);
    score = (row) => mini.get(row.teamId).points;
  } else {
    score = CRITERIA[first];
    if (!score) return sortGroup(group, rest, ctx); // unknown tiebreaker: skip it
  }

  // Split into sub-groups with equal scores, best first, then sort each.
  const buckets = new Map();
  for (const row of group) {
    const s = score(row);
    if (!buckets.has(s)) buckets.set(s, []);
    buckets.get(s).push(row);
  }
  const keys = [...buckets.keys()].sort((a, b) => b - a);
  if (keys.length === 1) return sortGroup(group, rest, ctx);
  return keys.flatMap((k) => sortGroup(buckets.get(k), rest, ctx));
}

// Main entry point.
// teams:     [{ id, name, shortName }]  teams in this table (zero-match teams still show)
// fixtures:  [{ id, homeTeamId, awayTeamId, round, scheduledAt (ms) }]
// results:   { [fixtureId]: { sets: [{ home, away }] } }
// season:    { format, standings }  falls back to JVO defaults
// Returns { rows (ranked, with `rank`), matches, problems }
export function computeStandings({ teams, fixtures, results, season = {} }) {
  const format = season.format ?? DEFAULT_FORMAT;
  const rules = season.standings ?? DEFAULT_STANDINGS;
  const teamIds = new Set(teams.map((t) => t.id));
  const relevant = fixtures.filter((f) => teamIds.has(f.homeTeamId) && teamIds.has(f.awayTeamId));

  const { matches, problems } = finishedMatches(relevant, results, format);
  const rows = [...tally(teams, matches, rules).values()];
  const ranked = sortGroup(rows, rules.tiebreakers ?? DEFAULT_STANDINGS.tiebreakers, { matches, rules });

  ranked.forEach((row, i) => {
    row.rank = i + 1;
    row.form = row.form.slice(-5);
  });
  return { rows: ranked, matches, problems };
}
