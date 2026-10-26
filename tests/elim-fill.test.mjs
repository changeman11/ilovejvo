import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillElimination, pendingRound } from '../public/js/rules/elim-fill.js';

const teams = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10'];
// Play everything out: the home team always wins. byesFor(round, free) picks byes when asked.
function run(kind, start = [], byesFor = () => []) {
  const fixtures = [...start];
  const results = new Set();
  const outcome = (f) => (results.has(f.id) ? { winner: f.homeTeamId, loser: f.awayTeamId } : null);
  let byes = {};
  let id = 0;
  for (let step = 0; step < 60; step++) {
    const args = { kind, fixtures, teamIds: teams, outcome, seed: 'ev', byes };
    const p = pendingRound(args);
    const out = fillElimination({ ...args, giveByes: p ? byesFor(p.round, p.free) : [] });
    assert.equal(out.problem, null);
    byes = out.byes;
    if (out.done) return { fixtures, byes };
    if (!out.add.length) {
      const open = fixtures.filter((f) => !results.has(f.id));
      if (!open.length && JSON.stringify(out.byes) !== JSON.stringify(args.byes)) continue; // a lone bye was saved
      assert.ok(open.length, `stuck at step ${step}`);
      open.forEach((f) => results.add(f.id));
      continue;
    }
    for (const m of out.add) fixtures.push({ id: `f${++id}`, order: 100 + id, ...m });
  }
  throw new Error('never finished');
}
const hand = [['t1', 't2'], ['t3', 't4'], ['t5', 't6'], ['t7', 't8']].map(([h, a], i) => ({ id: `m${i + 1}`, order: i + 1, label: String(i + 1), homeTeamId: h, awayTeamId: a }));

test('the admin’s numbering is kept: nothing renamed, new matches carry on the numbers', () => {
  const out = fillElimination({ kind: 'single', fixtures: hand, teamIds: teams, outcome: () => null, seed: 'ev' });
  assert.deepEqual(out.add.map((m) => m.label), ['5']);
  assert.equal(out.relabel, undefined, 'never renames');
  assert.deepEqual(pendingRound({ kind: 'single', fixtures: hand, teamIds: teams, outcome: () => null, seed: 'ev' }).free.sort(), ['t10', 't9']);
});

test('ticked teams get byes instead of playing (tonight: the two clubs left over both get a bye)', () => {
  const out = fillElimination({ kind: 'single', fixtures: hand, teamIds: teams, outcome: () => null, seed: 'ev', giveByes: ['t9', 't10'] });
  assert.deepEqual(out.add, []);
  assert.deepEqual(out.byes['Round 1'].sort(), ['t10', 't9']);
  // Round 1 played: the 4 winners + 2 byes make round 2 (6 teams -> 3 matches), numbered 5, 6, 7.
  const won = (f) => ({ winner: f.homeTeamId, loser: f.awayTeamId });
  const next = fillElimination({ kind: 'single', fixtures: hand, teamIds: teams, outcome: won, seed: 'ev', byes: out.byes });
  assert.deepEqual(next.add.map((m) => m.label), ['5', '6', '7']);
  const r2 = next.add.flatMap((m) => [m.homeTeamId, m.awayTeamId]).sort();
  assert.deepEqual(r2, ['t1', 't10', 't3', 't5', 't7', 't9'].sort());
});

test('single elimination plays out to one champion with nobody twice in a round', () => {
  const { fixtures } = run('single', hand, (round, free) => (round === 'Round 1' ? free : []));
  assert.equal(fixtures.length, 9, '10 teams: 9 matches');
});

test('double elimination with round labels: upper and lower brackets, then the Grand Final', () => {
  const { fixtures } = run('double');
  const labels = fixtures.map((f) => f.label);
  assert.ok(labels.some((l) => l.startsWith('Upper Round 1')));
  assert.ok(labels.some((l) => l.startsWith('Lower Round 1')));
  assert.ok(labels.includes('Grand Final'));
  assert.equal(fixtures.length, 2 * teams.length - 2);
  const losses = {};
  for (const f of fixtures) losses[f.awayTeamId] = (losses[f.awayTeamId] ?? 0) + 1;
  assert.ok(Object.values(losses).every((n) => n <= 2));
});

test('double elimination with plain numbers asks for round names', () => {
  const out = fillElimination({ kind: 'double', fixtures: hand, teamIds: teams, outcome: () => null });
  assert.match(out.problem, /needs round names/);
});

test('nothing to add while a round is still being played', () => {
  const fx = [{ id: 'a', order: 1, label: '1', homeTeamId: 't1', awayTeamId: 't2' }, { id: 'b', order: 2, label: '2', homeTeamId: 't3', awayTeamId: 't4' }];
  const out = fillElimination({ kind: 'single', fixtures: fx, teamIds: ['t1', 't2', 't3', 't4'], outcome: (f) => (f.id === 'a' ? { winner: 't1', loser: 't2' } : null) });
  assert.deepEqual(out.add, []);
});
