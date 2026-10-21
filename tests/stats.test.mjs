import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seasonPlayerStats, seasonTeamStats, rates, leaders } from '../public/js/rules/stats.js';
import { finishedMatches } from '../public/js/rules/standings.js';

const KEYS = ['pts', 'ace'];

// Two matches: A beats B 2-0, then B beats A 2-1. "kai" moves from A to B in between.
const fixtures = [
  { id: 'm1', homeTeamId: 'A', awayTeamId: 'B', round: 1, scheduledAt: 1 },
  { id: 'm2', homeTeamId: 'B', awayTeamId: 'A', round: 2, scheduledAt: 2 },
  { id: 'm3', homeTeamId: 'A', awayTeamId: 'B', round: 3, scheduledAt: 3 }, // bad result, must be ignored
];
const results = {
  m1: {
    sets: [{ home: 10, away: 4 }, { home: 10, away: 6 }],
    mvpPlayerId: 'ana',
    playerStats: {
      ana: { teamId: 'A', pts: 8, ace: 2 },
      kai: { teamId: 'A', pts: 4, ace: 0 },
      bo: { teamId: 'B', pts: 5, ace: 1 },
    },
  },
  m2: {
    sets: [{ home: 10, away: 8 }, { home: 6, away: 10 }, { home: 12, away: 10 }],
    mvpPlayerId: 'kai',
    playerStats: {
      kai: { teamId: 'B', pts: 9, ace: 3 },
      bo: { teamId: 'B', pts: 6 }, // missing stat counts as 0
      ana: { teamId: 'A', pts: 7, ace: 1 },
      ghost: { teamId: 'Z', pts: 99, ace: 99 }, // team not in this match: ignored
    },
  },
  m3: { sets: [{ home: 10, away: 9 }], playerStats: { ana: { teamId: 'A', pts: 50, ace: 50 } } },
};
const { matches } = finishedMatches(fixtures, results);

test('player totals, matches, sets, wins and MVPs', () => {
  const stats = seasonPlayerStats({ matches, results, statKeys: KEYS });
  const ana = stats.get('ana');
  assert.equal(ana.matches, 2);
  assert.equal(ana.sets, 5);
  assert.equal(ana.wins, 1);
  assert.equal(ana.mvps, 1);
  assert.deepEqual(ana.totals, { pts: 15, ace: 3 });
  assert.equal(stats.has('ghost'), false);
  assert.deepEqual(stats.get('bo').totals, { pts: 11, ace: 1 });
});

test('a player who changed teams keeps both, and the log knows which', () => {
  const kai = seasonPlayerStats({ matches, results, statKeys: KEYS }).get('kai');
  assert.deepEqual(kai.teamIds, ['A', 'B']);
  assert.deepEqual(kai.log.map((l) => [l.teamId, l.opponentId, l.won, l.setsFor, l.setsAgainst]), [
    ['A', 'B', true, 2, 0],
    ['B', 'A', true, 2, 1],
  ]);
});

test('teamId option counts only lines for that team', () => {
  const forB = seasonPlayerStats({ matches, results, statKeys: KEYS, teamId: 'B' });
  assert.equal(forB.get('kai').matches, 1);
  assert.equal(forB.has('ana'), false);
});

test('per-match and per-set rates', () => {
  const ana = seasonPlayerStats({ matches, results, statKeys: KEYS }).get('ana');
  const r = rates(ana, KEYS);
  assert.equal(r.perMatch.pts, 7.5);
  assert.equal(r.perSet.pts, 3);
  assert.deepEqual(rates({ matches: 0, sets: 0, totals: { pts: 0, ace: 0 } }, KEYS).perSet, { pts: 0, ace: 0 });
});

test('team totals add up every player line', () => {
  const teams = seasonTeamStats({ matches, results, statKeys: KEYS });
  assert.deepEqual(teams.get('A').totals, { pts: 8 + 4 + 7, ace: 3 });
  assert.deepEqual(teams.get('B').totals, { pts: 5 + 9 + 6, ace: 4 });
  assert.equal(teams.get('A').sets, 5);
  assert.equal(teams.has('Z'), false);
});

test('leaders: totals, averages and tie order', () => {
  const stats = seasonPlayerStats({ matches, results, statKeys: KEYS });
  assert.deepEqual(leaders(stats, 'pts').map((p) => p.playerId), ['ana', 'kai', 'bo']);
  // kai and ana tie on aces (3); same matches, so ID order
  assert.deepEqual(leaders(stats, 'ace', { limit: 2 }).map((p) => p.playerId), ['ana', 'kai']);
  assert.equal(leaders(stats, 'pts', { by: 'perMatch' })[0].value, 7.5);
  assert.equal(leaders(stats, 'pts', { minMatches: 3 }).length, 0);
});
