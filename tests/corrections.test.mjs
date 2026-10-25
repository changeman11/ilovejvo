import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixPending, fixesFor, agreeingFix, correctedResult, fixesToAgree } from '../public/js/rules/corrections.js';

const f = { id: 'm1', homeTeamId: 'H', awayTeamId: 'A' };
const s = (...pairs) => pairs.map(([home, away]) => ({ home, away }));
const result = { sets: s([10, 8], [10, 7]) }; // H won 2-0 (wrongly)
const right = s([8, 10], [10, 7], [7, 10]); // A won 2-1

test('pending: score fixes until applied; screenshots and notes until an admin closes them', () => {
  assert.equal(fixPending({ sets: right }, result), true);
  assert.equal(fixPending({ sets: right }, { sets: right }), false, 'already applied');
  assert.equal(fixPending({ sets: [], screenshotPaths: ['x'] }, result), true);
  assert.equal(fixPending({ sets: right, note: 'MVP was me' }, { sets: right }), true, 'note still needs an admin');
  assert.equal(fixPending({ sets: right, status: 'done' }, result), false);
  assert.equal(fixPending({ sets: [] }, result), false, 'empty fix');
});

test('fixes for a match split by team', () => {
  const list = [
    { id: 'm1__a', fixtureId: 'm1', teamId: 'H', sets: right, updatedAt: 1 },
    { id: 'm1__b', fixtureId: 'm1', teamId: 'A', sets: right, updatedAt: 2 },
    { id: 'm2__c', fixtureId: 'm2', teamId: 'A', sets: right },
  ];
  const out = fixesFor(list, f, result);
  assert.deepEqual(out.home.map((c) => c.id), ['m1__a']);
  assert.deepEqual(out.away.map((c) => c.id), ['m1__b']);
  assert.equal(out.pending.length, 2);
});

test('both teams send the same new score: it is applied', () => {
  const other = { id: 'm1__a', fixtureId: 'm1', teamId: 'H', sets: right };
  const mine = { id: 'm1__b', fixtureId: 'm1', teamId: 'A', sets: right };
  assert.equal(agreeingFix({ corrections: [other], fixture: f, result, mine }), other);
  assert.deepEqual(correctedResult({ fixture: f, mine, other }), { sets: right, correctedBy: ['m1__a', 'm1__b'] });
  assert.equal(agreeingFix({ corrections: [other], fixture: f, result: { sets: right }, mine }), null, 'no change');
  assert.equal(agreeingFix({ corrections: [{ ...other, sets: s([8, 10], [8, 10]) }], fixture: f, result, mine }), null, 'different score');
  assert.equal(agreeingFix({ corrections: [{ ...other, teamId: 'A' }], fixture: f, result, mine }), null, 'same team');
  assert.equal(agreeingFix({ corrections: [{ ...other, status: 'done' }], fixture: f, result, mine }), null, 'closed');
  assert.equal(agreeingFix({ corrections: [other], fixture: f, result: { ...result, forfeit: { teamId: 'H' } }, mine }), null, 'forfeits are admin only');
});

test('captain can agree to the other team’s score fix once', () => {
  const list = [
    { id: 'm1__a', fixtureId: 'm1', teamId: 'H', sets: right },
    { id: 'm1__a2', fixtureId: 'm1', teamId: 'H', sets: right },
    { id: 'm1__a3', fixtureId: 'm1', teamId: 'H', sets: [] },
  ];
  assert.deepEqual(fixesToAgree({ corrections: list, fixture: f, result, teamId: 'A' }).map((c) => c.id), ['m1__a']);
  assert.deepEqual(fixesToAgree({ corrections: [...list, { id: 'm1__b', fixtureId: 'm1', teamId: 'A', sets: right }], fixture: f, result, teamId: 'A' }), [], 'we already sent the same');
});
