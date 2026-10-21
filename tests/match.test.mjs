import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSet, checkResult } from '../public/js/rules/match.js';
import { DEFAULT_FORMAT, fivbMatchPoints } from '../public/js/rules/defaults.js';

const F = DEFAULT_FORMAT; // Bo3, sets to 10, win by 2, no cap

test('normal set wins to 10', () => {
  assert.equal(checkSet({ home: 10, away: 8 }, 0, F).winner, 'home');
  assert.equal(checkSet({ home: 0, away: 10 }, 0, F).winner, 'away');
});

test('set must reach 10 and be won by 2', () => {
  assert.equal(checkSet({ home: 9, away: 7 }, 0, F).ok, false);
  assert.equal(checkSet({ home: 10, away: 9 }, 0, F).ok, false);
  assert.equal(checkSet({ home: 10, away: 10 }, 0, F).ok, false);
});

test('deuce sets end exactly at a 2-point lead', () => {
  assert.equal(checkSet({ home: 11, away: 9 }, 0, F).ok, true);
  assert.equal(checkSet({ home: 14, away: 16 }, 1, F).ok, true);
  assert.equal(checkSet({ home: 13, away: 10 }, 0, F).ok, false); // should have ended at 12-10
  assert.equal(checkSet({ home: 12, away: 8 }, 0, F).ok, false); // should have ended at 10-8
});

test('bad input is rejected', () => {
  assert.equal(checkSet({ home: -1, away: 10 }, 0, F).ok, false);
  assert.equal(checkSet({ home: 'x', away: 10 }, 0, F).ok, false);
  assert.equal(checkSet({ home: 10.5, away: 8 }, 0, F).ok, false);
});

test('cap ends a set on a 1-point lead', () => {
  const capped = { ...F, cap: 15 };
  assert.equal(checkSet({ home: 15, away: 14 }, 0, capped).ok, true);
  assert.equal(checkSet({ home: 16, away: 14 }, 0, capped).ok, false);
});

test('shorter deciding set uses its own target', () => {
  const f = { ...F, decidingSetPoints: 7 };
  assert.equal(checkSet({ home: 7, away: 5 }, 2, f).ok, true);
  assert.equal(checkSet({ home: 7, away: 5 }, 1, f).ok, false);
});

test('2-0 and 2-1 results', () => {
  const a = checkResult([{ home: 10, away: 5 }, { home: 12, away: 10 }], F);
  assert.equal(a.ok, true);
  assert.deepEqual([a.homeSets, a.awaySets, a.homePoints, a.awayPoints, a.winner], [2, 0, 22, 15, 'home']);

  const b = checkResult([{ home: 10, away: 5 }, { home: 3, away: 10 }, { home: 8, away: 10 }], F);
  assert.equal(b.ok, true);
  assert.deepEqual([b.homeSets, b.awaySets, b.winner], [1, 2, 'away']);
});

test('unfinished or overlong matches are flagged', () => {
  assert.equal(checkResult([{ home: 10, away: 5 }], F).ok, false);
  assert.equal(checkResult([{ home: 10, away: 5 }, { home: 5, away: 10 }], F).ok, false);
  assert.equal(
    checkResult([{ home: 10, away: 5 }, { home: 10, away: 5 }, { home: 10, away: 5 }], F).ok,
    false
  );
  assert.equal(checkResult([], F).ok, false);
});

test('3/2/1/0 table points for any best-of', () => {
  assert.deepEqual(fivbMatchPoints(3), { '2-0': 3, '0-2': 0, '2-1': 2, '1-2': 1 });
  assert.deepEqual(fivbMatchPoints(5), {
    '3-0': 3, '0-3': 0, '3-1': 3, '1-3': 0, '3-2': 2, '2-3': 1,
  });
});
