import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextLabel, elimRound, ELIM_PREFIXES } from '../public/js/rules/bracket-labels.js';

test('next label numbers the matches in a round; one-match rounds have no number', () => {
  const fx = [{ id: 'a', label: 'Upper Round 1 · Match 1' }, { id: 'b', label: 'Upper Round 1 · Match 2' }, { id: 'c', label: 'Lower Round 1 · Match 1' }];
  assert.equal(nextLabel('Upper Round 1', fx), 'Upper Round 1 · Match 3');
  assert.equal(nextLabel('Upper Round 1', fx, 'b'), 'Upper Round 1 · Match 2', 'editing one doesn’t count itself');
  assert.equal(nextLabel('Lower Round 2', fx), 'Lower Round 2 · Match 1');
  assert.equal(nextLabel('Grand Final', fx), 'Grand Final');
  assert.equal(nextLabel('Round 1', fx), 'Round 1 · Match 1', '"Upper Round 1" doesn’t count as "Round 1"');
});

test('rounds are recognised from labels, longest prefix first', () => {
  assert.equal(elimRound('Upper Round 2 · Match 1'), 'Upper Round 2');
  assert.equal(elimRound('Grand Final Reset'), 'Grand Final Reset');
  assert.equal(elimRound('Grand Final'), 'Grand Final');
  assert.equal(elimRound('lower final'), 'Lower Final');
  assert.equal(elimRound('Round 1 · Match 4'), 'Round 1');
  assert.equal(elimRound('Showmatch'), null);
  assert.ok(ELIM_PREFIXES.double.rounds.includes('Grand Final Reset'));
});
