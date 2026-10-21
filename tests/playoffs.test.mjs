import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBracket, advanceUpdates, bracketProblems, bracketFixtures, projectedSeeds } from '../public/js/rules/playoffs.js';
import { formatFor, roundLabel, seasonMatches } from '../public/js/rules/season.js';
import { computeStandings } from '../public/js/rules/standings.js';
import { DEFAULT_FORMAT, DEFAULT_PLAYOFFS } from '../public/js/rules/defaults.js';

const season = {
  id: 's',
  format: DEFAULT_FORMAT,
  divisions: [{ id: 'd', teamIds: ['A', 'B', 'C', 'D', 'E'] }],
  playoffs: { ...DEFAULT_PLAYOFFS, seeds: ['A', 'B', 'C', 'D'] },
};
const W = [{ home: 10, away: 5 }, { home: 10, away: 5 }]; // home 2-0
const L = [{ home: 5, away: 10 }, { home: 5, away: 10 }]; // away 2-0

function fresh() {
  const fixtures = bracketFixtures(season, season.playoffs.seeds, 10);
  return { fixtures, byId: Object.fromEntries(fixtures.map((f) => [f.slot, f])) };
}

test('bracket fixtures: 1v4, 2v3, final TBC, rounds numbered after the season', () => {
  const { byId } = fresh();
  assert.deepEqual([byId.sf1.homeTeamId, byId.sf1.awayTeamId], ['A', 'D']);
  assert.deepEqual([byId.sf2.homeTeamId, byId.sf2.awayTeamId], ['B', 'C']);
  assert.deepEqual([byId.final.homeTeamId, byId.final.awayTeamId, byId.final.round], [null, null, 12]);
  assert.equal(byId.sf1.round, 11);
});

test('final is best of 5, semis best of 3, regular stays the same', () => {
  const { byId } = fresh();
  assert.equal(formatFor(season, byId.final).bestOf, 5);
  assert.equal(formatFor(season, byId.sf1).bestOf, 3);
  assert.equal(formatFor(season, { round: 2 }).bestOf, 3);
  assert.equal(roundLabel(season, byId.final), 'Grand final');
  assert.equal(roundLabel(season, byId.sf2, { short: true }), 'SF');
  assert.equal(roundLabel(season, { round: 4 }, { short: true }), 'R4');
});

test('winners advance; better seed hosts the final', () => {
  const { fixtures, byId } = fresh();
  const results = { [byId.sf1.id]: { sets: L }, [byId.sf2.id]: { sets: W } }; // D beats A, B beats C
  const bracket = resolveBracket(season, fixtures, results);
  assert.equal(bracket.bySlot.sf1.winnerTeamId, 'D');
  assert.deepEqual([bracket.bySlot.final.homeTeamId, bracket.bySlot.final.awayTeamId], ['B', 'D']);
  assert.deepEqual(advanceUpdates(season, fixtures, results), [{ fixtureId: 'po-final', homeTeamId: 'B', awayTeamId: 'D' }]);
  assert.equal(bracket.championId, null);
});

test('only one semi decided: final half-filled on that semi\'s side', () => {
  const { fixtures, byId } = fresh();
  const updates = advanceUpdates(season, fixtures, { [byId.sf2.id]: { sets: W } });
  assert.deepEqual(updates, [{ fixtureId: 'po-final', homeTeamId: null, awayTeamId: 'B' }]);
});

test('champion from a best-of-5 final', () => {
  const { fixtures, byId } = fresh();
  byId.final.homeTeamId = 'A';
  byId.final.awayTeamId = 'B';
  const bo5 = [{ home: 10, away: 5 }, { home: 5, away: 10 }, { home: 10, away: 8 }, { home: 9, away: 11 }, { home: 12, away: 10 }];
  const results = { [byId.sf1.id]: { sets: W }, [byId.sf2.id]: { sets: W }, [byId.final.id]: { sets: bo5 } };
  const bracket = resolveBracket(season, fixtures, results);
  assert.equal(bracket.championId, 'A');
  assert.deepEqual(advanceUpdates(season, fixtures, results), []);
  assert.deepEqual(bracketProblems(season, fixtures, results), []);

  // Semi changed after the final was played: flagged, final left alone.
  const changed = { ...results, [byId.sf1.id]: { sets: L } };
  assert.equal(bracketProblems(season, fixtures, changed).length, 1);
  assert.deepEqual(advanceUpdates(season, fixtures, changed), []);
});

test('a fixture can set its own best-of', () => {
  assert.equal(formatFor(season, { round: 1, bestOf: 5 }).bestOf, 5);
  assert.equal(formatFor(season, { round: 1, bestOf: 5 }).pointsPerSet, 10);
  assert.equal(formatFor(season, { round: 1 }).bestOf, 3);
});

test('no seeds = no bracket; projected seeds = top 4', () => {
  assert.equal(resolveBracket({ ...season, playoffs: { ...DEFAULT_PLAYOFFS } }, [], {}), null);
  assert.deepEqual(projectedSeeds([{ teamId: 'X' }, { teamId: 'Y' }, { teamId: 'Z' }, { teamId: 'Q' }, { teamId: 'R' }]), ['X', 'Y', 'Z', 'Q']);
});

test('playoff matches count in stats but never in the table', () => {
  const { fixtures, byId } = fresh();
  const regular = { id: 'r1', homeTeamId: 'A', awayTeamId: 'E', round: 1, scheduledAt: 1 };
  const all = [regular, ...fixtures];
  const results = { r1: { sets: W }, [byId.sf1.id]: { sets: W } };
  const table = computeStandings({ teams: season.divisions[0].teamIds.map((id) => ({ id, name: id })), fixtures: all, results, season });
  assert.equal(table.rows.find((r) => r.teamId === 'A').played, 1);
  const { matches } = seasonMatches({ season, fixtures: all, results });
  assert.equal(matches.length, 2);
  assert.equal(matches[1].stage, 'playoffs');
});
