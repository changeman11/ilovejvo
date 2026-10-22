import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lockTime, isLocked, signupsOpen, entrantIds, groupFixtures, schedulePlan } from '../public/js/rules/autofix.js';

const HOUR = 3600000;
const start = Date.UTC(2026, 10, 1, 9, 0);
const season = { format: { bestOf: 3, pointsPerSet: 10, decidingSetPoints: 10, winBy: 2, cap: null } };
const ev = (extra = {}) => ({ id: 'e', published: true, signups: true, status: 'upcoming', date: start, timeTbd: false, teamIds: [], autoFixtures: 'once', ...extra });
const entry = (teamId, createdAt) => ({ teamId, createdAt });
const win = { sets: [{ home: 10, away: 5 }, { home: 10, away: 6 }] };
const lose = { sets: [{ home: 5, away: 10 }, { home: 6, away: 10 }] };

test('sign-ups close 10 minutes before the start', () => {
  assert.equal(lockTime(ev()), start - 10 * 60000);
  assert.equal(signupsOpen(ev(), start - 11 * 60000), true);
  assert.equal(signupsOpen(ev(), start - 10 * 60000), false);
  assert.equal(signupsOpen(ev({ signups: false }), start - HOUR), false);
  assert.equal(signupsOpen(ev({ published: false }), start - HOUR), false);
  // No start time yet: stays open until an admin locks it
  assert.equal(lockTime(ev({ timeTbd: true })), null);
  assert.equal(signupsOpen(ev({ date: null }), start + HOUR), true);
  assert.equal(isLocked(ev({ date: null, fixturesLockedAt: 1 }), 0), true);
  assert.equal(isLocked(ev({ status: 'finished' }), 0), true);
});

test('teams: admin-added first, then clubs in sign-up order', () => {
  assert.deepEqual(entrantIds(ev({ teamIds: ['z'] }), [entry('b', 2), entry('a', 1), entry('z', 0)]), ['z', 'a', 'b']);
});

test('the round robin follows the sign-ups until the lock', () => {
  const before = start - HOUR;
  let plan = schedulePlan({ event: ev(), season, entries: [entry('a', 1), entry('b', 2)], now: before });
  assert.equal(plan.virtual.length, 1);
  assert.equal(plan.toSave.length, 0);
  plan = schedulePlan({ event: ev(), season, entries: [entry('a', 1), entry('b', 2), entry('c', 3)], now: before });
  assert.equal(plan.virtual.length, 3);
  assert.ok(plan.virtual.every((f) => f.virtual && f.id.startsWith('auto-r')));
  // After the lock the same fixtures are due to be saved, with the same ids
  const after = schedulePlan({ event: ev(), season, entries: [entry('a', 1), entry('b', 2), entry('c', 3)], now: start });
  assert.deepEqual(after.toSave.map((f) => f.id), plan.virtual.map((f) => f.id));
  assert.equal(after.lockGroup, true);
  // Once saved (fixturesLockedAt), nothing new is generated
  const done = schedulePlan({ event: ev({ fixturesLockedAt: start }), season, entries: [entry('a', 1), entry('b', 2), entry('c', 3), entry('d', 4)], fixtures: after.toSave, now: start + HOUR });
  assert.equal(done.virtual.length, 0);
  assert.equal(done.toSave.length, 0);
});

test('home & away doubles the games; manual matchups are not repeated', () => {
  assert.equal(groupFixtures(ev({ autoFixtures: 'double' }), ['a', 'b', 'c']).length, 6);
  assert.equal(groupFixtures(ev({ autoFixtures: 'off' }), ['a', 'b']).length, 0);
  const plan = schedulePlan({ event: ev(), season, entries: [entry('a', 1), entry('b', 2), entry('c', 3)], fixtures: [{ id: 'm1', homeTeamId: 'b', awayTeamId: 'a' }], now: 0 });
  assert.equal(plan.virtual.length, 2);
});

test('final: placeholders, then 1st v 2nd once the group is done', () => {
  const event = ev({ finals: { type: 'final', finalBestOf: 5 }, fixturesLockedAt: start });
  const group = groupFixtures(event, ['a', 'b', 'c']);
  let plan = schedulePlan({ event, season, entries: [entry('a', 1), entry('b', 2), entry('c', 3)], fixtures: group, now: start });
  const final = plan.virtual.find((f) => f.id === 'finals-final');
  assert.equal(final.homeTeamId, null);
  assert.equal(final.homePlaceholder, '1st place');
  assert.equal(final.stage, 'playoffs');
  assert.equal(plan.toSave.length, 0);
  // a beats everyone, b beats c
  const results = {};
  for (const f of group) {
    const winner = [f.homeTeamId, f.awayTeamId].includes('a') ? 'a' : 'b';
    results[f.id] = f.homeTeamId === winner ? win : lose;
  }
  plan = schedulePlan({ event, season, entries: [entry('a', 1), entry('b', 2), entry('c', 3)], fixtures: group, results, now: start });
  assert.deepEqual(plan.toSave.map((f) => [f.id, f.homeTeamId, f.awayTeamId, f.bestOf]), [['finals-final', 'a', 'b', 5]]);
});

test('semis: 1v4 and 2v3, then the winners meet', () => {
  const event = ev({ finals: { type: 'semis' }, fixturesLockedAt: start });
  const teams = ['a', 'b', 'c', 'd'];
  const group = groupFixtures(event, teams);
  const rank = { a: 1, b: 2, c: 3, d: 4 };
  const results = Object.fromEntries(group.map((f) => [f.id, rank[f.homeTeamId] < rank[f.awayTeamId] ? win : lose]));
  const entries = teams.map((t, i) => entry(t, i));
  let plan = schedulePlan({ event, season, entries, fixtures: group, results, now: start });
  assert.deepEqual(plan.toSave.map((f) => [f.id, f.homeTeamId, f.awayTeamId]), [['finals-sf1', 'a', 'd'], ['finals-sf2', 'b', 'c']]);
  // Save the semis; d upsets a, b beats c
  const semis = plan.toSave;
  plan = schedulePlan({ event, season, entries, fixtures: [...group, ...semis], results: { ...results, 'finals-sf1': lose, 'finals-sf2': win }, now: start });
  assert.deepEqual(plan.toSave.map((f) => [f.id, f.homeTeamId, f.awayTeamId]), [['finals-final', 'd', 'b']]);
  // Finals don't count in the group table: seeds stay the same with the semis saved
  assert.equal(plan.virtual.filter((f) => f.id.startsWith('finals-sf')).length, 0);
});

test('semis need 4 teams', () => {
  const plan = schedulePlan({ event: ev({ finals: { type: 'semis' } }), season, entries: [entry('a', 1), entry('b', 2), entry('c', 3)], now: 0 });
  assert.match(plan.finalsNote, /at least 4/);
  assert.equal(plan.virtual.filter((f) => f.stage === 'playoffs').length, 0);
});
