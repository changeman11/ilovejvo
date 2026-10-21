import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forfeitSets, visibleSetCount, cleanStatLine, suggestMvp, reviewResult } from '../public/js/rules/results.js';
import { checkResult } from '../public/js/rules/match.js';
import { DEFAULT_FORMAT } from '../public/js/rules/defaults.js';

const F = DEFAULT_FORMAT;

test('forfeit is a valid 2-0 with sets 10-0', () => {
  assert.deepEqual(forfeitSets(F, 'away'), [{ home: 0, away: 10 }, { home: 0, away: 10 }]);
  const check = checkResult(forfeitSets(F, 'home'), F);
  assert.equal(check.ok, true);
  assert.deepEqual([check.homeSets, check.awaySets, check.homePoints], [2, 0, 20]);
});

test('forfeit follows the season format (best of 5)', () => {
  const bo5 = { ...F, bestOf: 5, pointsPerSet: 25, decidingSetPoints: 15 };
  assert.equal(forfeitSets(bo5, 'home').length, 3);
  assert.equal(checkResult(forfeitSets(bo5, 'home'), bo5).ok, true);
});

test('third set only shows at 1-1', () => {
  assert.equal(visibleSetCount([], F), 2);
  assert.equal(visibleSetCount([{ home: 10, away: 5 }], F), 2);
  assert.equal(visibleSetCount([{ home: 10, away: 5 }, { home: 10, away: 7 }], F), 2); // 2-0
  assert.equal(visibleSetCount([{ home: 10, away: 5 }, { home: 7, away: 10 }], F), 3); // 1-1
  assert.equal(visibleSetCount([{ home: 10, away: 9 }, { home: 7, away: 10 }], F), 2); // set 1 invalid
});

test('stat lines become clean whole numbers', () => {
  assert.deepEqual(cleanStatLine({ pts: '7', ace: '', spk: '-2', blk: '2.9' }, ['pts', 'ace', 'spk', 'blk', 'dig']), {
    pts: 7, ace: 0, spk: 0, blk: 2, dig: 0,
  });
});

test('MVP suggestion: top scorer on the winning team', () => {
  const stats = {
    a: { teamId: 'X', pts: 9, spk: 5 },
    b: { teamId: 'X', pts: 9, spk: 7 },
    c: { teamId: 'Y', pts: 20, spk: 9 },
  };
  assert.equal(suggestMvp(stats, 'X'), 'b');
  assert.equal(suggestMvp(stats, 'Z'), null);
});

test('review flags missing and odd data but not good results', () => {
  const ctx = { homeTeamId: 'H', awayTeamId: 'A', teamSize: 2, rosters: { H: { playerIds: ['h1', 'h2'] }, A: { playerIds: ['a1', 'a2'] } } };
  const good = {
    sets: [{ home: 10, away: 4 }, { home: 10, away: 6 }],
    mvpPlayerId: 'h1',
    playerStats: { h1: { teamId: 'H' }, h2: { teamId: 'H' }, a1: { teamId: 'A' }, a2: { teamId: 'A' } },
  };
  assert.deepEqual(reviewResult(good, ctx), { errors: [], warnings: [] });

  const odd = { ...good, mvpPlayerId: null, playerStats: { h1: { teamId: 'H' }, zz: { teamId: 'A' } } };
  const { warnings } = reviewResult(odd, ctx);
  assert.equal(warnings.length, 4); // 1 for H, 1 for A, stray player, no MVP

  assert.deepEqual(reviewResult({ ...good, playerStats: {}, mvpPlayerId: null }, ctx).warnings, ['No player stats entered', 'No MVP picked']);
  assert.equal(reviewResult({ sets: [{ home: 10, away: 9 }] }, ctx).errors.length > 0, true);
  assert.deepEqual(reviewResult({ sets: forfeitSets(F, 'home'), forfeit: { teamId: 'A' } }, ctx), { errors: [], warnings: [] });
});
