// From a screenshot reading to the stats draft (src/logic/reading.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shotFor, shotToRead, learnPrints } from '../src/logic/reading.js';

const pending = { statsStatus: 'pending', playerStats: {}, confirmedBy: ['f1__b'] };
const subs = [
  { id: 'f1__a', screenshotPaths: ['a.png'], updatedAt: 9 },
  { id: 'f1__b', screenshotPaths: ['funny.gif', 'b.png'], updatedAt: 1 },
];

test('which screenshot: the confirming votes first, a still picture before a GIF, then thread copies', () => {
  assert.equal(shotFor(pending, subs), 'b.png');
  assert.equal(shotFor({ ...pending, confirmedBy: [] }, subs), 'a.png');
  assert.equal(shotFor({ ...pending, threadShots: ['t.png'] }, []), 't.png');
  assert.equal(shotFor(pending, [{ id: 'x', screenshotPaths: ['only.gif'] }]), null);
});

test('read once per screenshot, not after staff submit, and a failure is tried again later', () => {
  assert.equal(shotToRead(pending, subs), 'b.png');
  assert.equal(shotToRead({ ...pending, statsStatus: 'reviewed' }, subs), null);
  assert.equal(shotToRead({ ...pending, forfeit: { teamId: 'x' } }, subs), null);
  assert.equal(shotToRead({ ...pending, statsDraft: { shot: 'b.png', rows: [] } }, subs), null);
  assert.equal(shotToRead({ ...pending, statsDraft: { shot: 'old.png', rows: [] } }, subs), 'b.png', 'a newer screenshot is read');
  assert.equal(shotToRead({ ...pending, statsDraft: { shot: 'b.png', reading: true, at: 0 } }, subs, { now: 60000 }), null, 'an admin browser is on it');
  const tried = new Map([['b.png', 0]]);
  assert.equal(shotToRead(pending, subs, { tried, now: 60000 }), null);
  assert.equal(shotToRead(pending, subs, { tried, now: 16 * 60000 }), 'b.png');
});

test('name pictures are learned only from lines people confirmed or answered', () => {
  const rows = [
    { playerId: 'a', print: 'pa', confirmedBy: '1' },
    { playerId: 'b', print: 'pb' }, // the reader's own guess
    { playerId: 'c', print: 'pc', answeredBy: '2' },
    { playerId: null, notPlayer: true, print: 'px', answeredBy: '2' },
  ];
  assert.deepEqual(learnPrints({ a: ['old'] }, rows), { a: ['pa', 'old'], c: ['pc'] });
  assert.equal(learnPrints({ a: ['pa'], c: ['pc'] }, rows), null, 'nothing new');
  assert.equal(learnPrints({ a: ['1', '2', '3', '4', '5', '6'] }, rows).a.length, 6, 'kept to 6 each');
});
