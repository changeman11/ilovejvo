import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStandings, ratio } from '../public/js/rules/standings.js';
import { WIN_ONE_STANDINGS, DEFAULT_FORMAT } from '../public/js/rules/defaults.js';

const teams = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Bravo' },
  { id: 'c', name: 'Charlie' },
  { id: 'd', name: 'Delta' },
];

// Helpers to write results quickly
const W20 = [{ home: 10, away: 5 }, { home: 10, away: 5 }]; // home wins 2-0
const W21 = [{ home: 10, away: 5 }, { home: 5, away: 10 }, { home: 10, away: 8 }]; // home wins 2-1
const L12 = [{ home: 10, away: 5 }, { home: 5, away: 10 }, { home: 8, away: 10 }]; // home loses 1-2

let n = 0;
function fx(home, away, sets) {
  n++;
  return { fixture: { id: `f${n}`, homeTeamId: home, awayTeamId: away, round: n, scheduledAt: n }, sets };
}
function build(list) {
  return {
    fixtures: list.map((x) => x.fixture),
    results: Object.fromEntries(list.filter((x) => x.sets).map((x) => [x.fixture.id, { sets: x.sets }])),
  };
}

test('ratio handles zero losses', () => {
  assert.equal(ratio(0, 0), 0);
  assert.equal(ratio(4, 0), Infinity);
  assert.equal(ratio(3, 2), 1.5);
});

test('points, sets and form add up', () => {
  const { fixtures, results } = build([fx('a', 'b', W20), fx('c', 'a', L12), fx('b', 'c', W21)]);
  const { rows } = computeStandings({ teams, fixtures, results });
  const a = rows.find((r) => r.teamId === 'a');
  assert.equal(a.played, 2);
  assert.equal(a.wins, 2);
  assert.equal(a.points, 3 + 2);
  assert.equal(a.setsWon, 4);
  assert.equal(a.setsLost, 1);
  assert.deepEqual(a.form.map((f) => f.result), ['W', 'W']);

  const c = rows.find((r) => r.teamId === 'c');
  assert.equal(c.points, 1 + 1); // two 1-2 losses
  assert.equal(rows[0].teamId, 'a');
});

test('teams with no matches still appear', () => {
  const { fixtures, results } = build([fx('a', 'b', W20)]);
  const { rows } = computeStandings({ teams, fixtures, results });
  assert.equal(rows.length, 4);
  assert.equal(rows.find((r) => r.teamId === 'd').played, 0);
});

test('scheduled fixtures without results are ignored', () => {
  const { fixtures, results } = build([fx('a', 'b', W20), fx('c', 'd', null)]);
  const { rows, matches } = computeStandings({ teams, fixtures, results });
  assert.equal(matches.length, 1);
  assert.equal(rows.find((r) => r.teamId === 'c').played, 0);
});

test('invalid results are reported, not counted', () => {
  const { fixtures, results } = build([fx('a', 'b', [{ home: 10, away: 9 }, { home: 10, away: 5 }])]);
  const { rows, problems } = computeStandings({ teams, fixtures, results });
  assert.equal(problems.length, 1);
  assert.equal(rows.find((r) => r.teamId === 'a').played, 0);
});

test('equal points: more wins ranks higher', () => {
  // a: one 2-1 win (2 pts) ... b: two 1-2 losses (2 pts), 0 wins
  const { fixtures, results } = build([fx('a', 'c', W21), fx('b', 'c', L12), fx('b', 'd', L12)]);
  const { rows } = computeStandings({ teams: teams.slice(0, 2), fixtures, results });
  // only a and b are in this table, so c/d matches are filtered out
  assert.deepEqual(rows.map((r) => r.played), [0, 0]);

  const all = computeStandings({ teams, fixtures, results }).rows;
  const ia = all.findIndex((r) => r.teamId === 'a');
  const ib = all.findIndex((r) => r.teamId === 'b');
  assert.equal(all[ia].points, all[ib].points);
  assert.ok(ia < ib, 'a has 1 win, b has 0');
});

test('set ratio then point ratio break ties', () => {
  // a beats c 2-0 (10-5,10-5); b beats d 2-0 (10-8,10-8). Same pts, wins, set ratio; a has better point ratio.
  const close = [{ home: 10, away: 8 }, { home: 10, away: 8 }];
  const { fixtures, results } = build([fx('a', 'c', W20), fx('b', 'd', close)]);
  const { rows } = computeStandings({ teams, fixtures, results });
  assert.deepEqual(rows.slice(0, 2).map((r) => r.teamId), ['a', 'b']);
});

test('head-to-head decides when everything else is equal', () => {
  // a and b both: beat c 2-0, beat d 2-0... then b beats a? that changes points.
  // Instead: a and b each have one 2-0 win and one 0-2 loss with identical scores,
  // and b's win came against a directly.
  const S = [{ home: 10, away: 5 }, { home: 10, away: 5 }];
  const { fixtures, results } = build([
    fx('b', 'a', S), // b beats a
    fx('a', 'c', S), // a beats c
    fx('d', 'b', S), // d beats b
  ]);
  const tiebreakers = ['points', 'wins', 'setRatio', 'pointRatio', 'h2h'];
  const { rows } = computeStandings({
    teams: teams.slice(0, 2).concat(teams.slice(2)),
    fixtures,
    results,
    season: { format: DEFAULT_FORMAT, standings: { matchPoints: { '2-0': 3, '2-1': 2, '1-2': 1, '0-2': 0 }, tiebreakers } },
  });
  const ia = rows.findIndex((r) => r.teamId === 'a');
  const ib = rows.findIndex((r) => r.teamId === 'b');
  assert.equal(rows[ia].points, rows[ib].points);
  assert.equal(rows[ia].pointRatio, rows[ib].pointRatio);
  assert.ok(ib < ia, 'b beat a head-to-head');
});

test('fully level teams fall back to name order', () => {
  const { rows } = computeStandings({ teams, fixtures: [], results: {} });
  assert.deepEqual(rows.map((r) => r.name), ['Alpha', 'Bravo', 'Charlie', 'Delta']);
  assert.deepEqual(rows.map((r) => r.rank), [1, 2, 3, 4]);
});

test('"win = 1" mode', () => {
  const { fixtures, results } = build([fx('a', 'b', W21)]);
  const { rows } = computeStandings({ teams, fixtures, results, season: { standings: WIN_ONE_STANDINGS } });
  assert.equal(rows.find((r) => r.teamId === 'a').points, 1);
  assert.equal(rows.find((r) => r.teamId === 'b').points, 0);
});

test('form keeps only the last 5, oldest first', () => {
  const list = [];
  for (let i = 0; i < 7; i++) list.push(fx('a', 'b', i < 2 ? L12 : W20));
  const { fixtures, results } = build(list);
  const a = computeStandings({ teams, fixtures, results }).rows.find((r) => r.teamId === 'a');
  assert.equal(a.form.length, 5);
  assert.deepEqual(a.form.map((f) => f.result), ['W', 'W', 'W', 'W', 'W']);
  assert.equal(a.played, 7);
});
