import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillElimination } from '../public/js/rules/elim-fill.js';

const teams = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10'];
// Play out: the home team always wins (simple and predictable).
function run(kind, start = []) {
  const fixtures = [...start];
  const results = new Set(start.filter((f) => f.played).map((f) => f.id));
  const outcome = (f) => (results.has(f.id) ? { winner: f.homeTeamId, loser: f.awayTeamId } : null);
  let id = fixtures.length;
  for (let step = 0; step < 40; step++) {
    const out = fillElimination({ kind, fixtures, teamIds: teams, outcome, seed: 'ev' });
    for (const r of out.relabel) fixtures.find((f) => f.id === r.id).label = r.label;
    if (out.done) return { fixtures, out };
    if (!out.add.length) {
      // Nothing to add: play every unplayed match.
      const open = fixtures.filter((f) => !results.has(f.id));
      assert.ok(open.length, `stuck at step ${step}`);
      open.forEach((f) => results.add(f.id));
      continue;
    }
    for (const m of out.add) fixtures.push({ id: `f${++id}`, order: id, ...m });
  }
  throw new Error('never finished');
}

test('single elimination: fills the rest of round 1 after a few made by hand, then each round', () => {
  // An admin made 4 matches labelled "1".."4" (8 of the 10 teams).
  const start = [['t1', 't2'], ['t3', 't4'], ['t5', 't6'], ['t7', 't8']].map(([h, a], i) => ({ id: `m${i + 1}`, order: i + 1, label: String(i + 1), homeTeamId: h, awayTeamId: a }));
  const first = fillElimination({ kind: 'single', fixtures: start, teamIds: teams, outcome: () => null, seed: 'ev' });
  assert.deepEqual(first.add.map((m) => [m.label, [m.homeTeamId, m.awayTeamId].sort().join('v')]), [['Round 1 · Match 5', 't10vt9']]);
  assert.deepEqual(first.relabel.map((r) => r.label), ['Round 1 · Match 1', 'Round 1 · Match 2', 'Round 1 · Match 3', 'Round 1 · Match 4']);
  const { fixtures } = run('single', start);
  const labels = fixtures.map((f) => f.label);
  assert.ok(labels.includes('Final'));
  // 10 teams: 9 matches in all (everyone but the champion loses once).
  assert.equal(fixtures.length, 9);
  // Nobody plays twice in a round.
  for (const r of new Set(labels.map((l) => l.split(' · ')[0]))) {
    const ts = fixtures.filter((f) => f.label.split(' · ')[0] === r).flatMap((f) => [f.homeTeamId, f.awayTeamId]);
    assert.equal(new Set(ts).size, ts.length, `${r} has a team twice`);
  }
});

test('double elimination: upper and lower brackets, then the Grand Final', () => {
  const { fixtures } = run('double');
  const labels = fixtures.map((f) => f.label);
  assert.ok(labels.some((l) => l.startsWith('Upper Round 1')));
  assert.ok(labels.some((l) => l.startsWith('Lower Round 1')));
  assert.ok(labels.includes('Grand Final'));
  // Every team but the champion loses twice, except the GF loser if the upper team won: 2n-2 matches.
  assert.equal(fixtures.length, 2 * teams.length - 2);
  // Each team loses at most twice.
  const losses = {};
  for (const f of fixtures) losses[f.awayTeamId] = (losses[f.awayTeamId] ?? 0) + 1;
  assert.ok(Object.values(losses).every((n) => n <= 2));
});

test('nothing to add while a round is still being played', () => {
  const fx = [{ id: 'a', order: 1, label: 'Round 1 · Match 1', homeTeamId: 't1', awayTeamId: 't2' }, { id: 'b', order: 2, label: 'Round 1 · Match 2', homeTeamId: 't3', awayTeamId: 't4' }];
  const out = fillElimination({ kind: 'single', fixtures: fx, teamIds: ['t1', 't2', 't3', 't4'], outcome: (f) => (f.id === 'a' ? { winner: 't1', loser: 't2' } : null) });
  assert.deepEqual(out.add, []);
});
