import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rpDelta, tallyReports, rpLabel, isPlaced } from '../src/logic/ranked.js';
import { newRecord, applyChange } from '../src/logic/ratings.js';

test('placements are ±50 for the first 5 games, then ±20', () => {
  let r = newRecord('p', 'P', 1000);
  const results = [true, true, false, true, true, false, true];
  const deltas = [];
  for (const won of results) {
    const delta = rpDelta(r, won);
    deltas.push(delta);
    r = applyChange(r, { won, delta }, 1);
  }
  assert.deepEqual(deltas, [50, 50, -50, 50, 50, -20, 20]);
  assert.equal(r.rating, 1000 + 150 + 0);
  assert.ok(isPlaced(r));
});

test('both players must agree on the winner', () => {
  assert.equal(tallyReports({}).status, 'waiting');
  assert.equal(tallyReports({ a: { winner: 'a' } }).status, 'waiting');
  assert.deepEqual(tallyReports({ a: { winner: 'b' }, b: { winner: 'b' } }), { status: 'agreed', winner: 'b' });
  assert.equal(tallyReports({ a: { winner: 'a' }, b: { winner: 'b' } }).status, 'disputed');
});

test('RP labels', () => {
  assert.equal(rpLabel(null), 'unranked');
  assert.equal(rpLabel({ games: 3, rating: 1050 }), 'placing 3/5 (1050 RP)');
  assert.equal(rpLabel({ games: 6, rating: 1130 }), '1130 RP');
});
