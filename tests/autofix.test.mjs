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

// ---------- Group stages ----------
import { drawGroups, groupFixtures as gf, matchCount, drawToSave } from '../public/js/rules/autofix.js';

const teams12 = Array.from({ length: 12 }, (_, i) => `t${i + 1}`);
const gev = (extra = {}) => ev({ id: 'cup', groups: { count: 3 }, ...extra });

test('automatic draw: even groups, same every time, whatever the sign-up order', () => {
  const g = drawGroups(gev(), teams12);
  assert.deepEqual(Object.keys(g), ['A', 'B', 'C']);
  assert.deepEqual(Object.values(g).map((x) => x.length), [4, 4, 4]);
  assert.deepEqual(drawGroups(gev(), [...teams12].reverse()), g);
  assert.deepEqual(new Set(Object.values(g).flat()), new Set(teams12));
  // 10 teams in 3 groups: 4, 3, 3
  assert.deepEqual(Object.values(drawGroups(gev(), teams12.slice(0, 10))).map((x) => x.length).sort(), [3, 3, 4]);
});

test('teams placed by hand stay put; the rest are drawn around them', () => {
  const g = drawGroups(gev({ groups: { count: 3, assign: { t1: 'C', t2: 'C', t3: 'C' } } }), teams12);
  assert.ok(['t1', 't2', 't3'].every((t) => g.C.includes(t)));
  assert.deepEqual(Object.values(g).map((x) => x.length), [4, 4, 4]);
});

test('round robins inside each group: 12 teams in 3 groups is 18 matches, not 66', () => {
  const g = drawGroups(gev(), teams12);
  const fx = gf(gev(), g);
  assert.equal(fx.length, 18);
  assert.equal(matchCount(gev(), 12), 18);
  assert.equal(matchCount(ev(), 12), 66);
  for (const f of fx) assert.ok(g[f.group].includes(f.homeTeamId) && g[f.group].includes(f.awayTeamId));
  assert.match(fx[0].id, /^auto-g[A-C]-r1-/);
  assert.match(fx[0].label, /^Group [A-C] · Round 1$/);
});

// Plays every group match so lower team numbers win (t1 beats everyone in its group...).
function playAll(fixtures) {
  const num = (id) => Number(id.slice(1));
  return Object.fromEntries(fixtures.map((f) => [f.id, num(f.homeTeamId) < num(f.awayTeamId) ? win : lose]));
}

test('2 groups, top 4: crossover semis A1 v B2 and B1 v A2', () => {
  const event = ev({ id: 'x', groups: { count: 2, assign: { t1: 'A', t2: 'A', t3: 'A', t4: 'B', t5: 'B', t6: 'B' } }, finals: { type: 'semis' }, fixturesLockedAt: start });
  const entries = ['t1', 't2', 't3', 't4', 't5', 't6'].map((t, i) => entry(t, i));
  const fixtures = gf(event, drawGroups(event, entries.map((e) => e.teamId)));
  let plan = schedulePlan({ event, season, entries, fixtures, now: start });
  assert.equal(plan.virtual.find((f) => f.id === 'finals-sf1').homePlaceholder, 'Winner Group A');
  assert.equal(plan.virtual.find((f) => f.id === 'finals-sf1').awayPlaceholder, 'Runner-up Group B');
  plan = schedulePlan({ event, season, entries, fixtures, results: playAll(fixtures), now: start });
  assert.deepEqual(plan.toSave.map((f) => [f.id, f.homeTeamId, f.awayTeamId]), [['finals-sf1', 't1', 't5'], ['finals-sf2', 't4', 't2']]);
  assert.equal(plan.tables.A.rows[0].teamId, 't1');
});

test('3 groups, top 4: the 3 winners and the best runner-up', () => {
  const event = gev({ finals: { type: 'semis' }, fixturesLockedAt: start });
  const entries = teams12.map((t, i) => entry(t, i));
  const groups = drawGroups(event, teams12);
  const fixtures = gf(event, groups);
  const plan = schedulePlan({ event, season, entries, fixtures, results: playAll(fixtures), now: start });
  const semis = plan.toSave.filter((f) => f.id.startsWith('finals-sf'));
  assert.equal(semis.length, 2);
  const teamsIn = semis.flatMap((f) => [f.homeTeamId, f.awayTeamId]);
  const winners = Object.values(groups).map((g) => [...g].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))[0]);
  assert.ok(winners.every((w) => teamsIn.includes(w)));
  // No semi between two teams from the same group
  const groupOf = (t) => Object.keys(groups).find((l) => groups[l].includes(t));
  for (const f of semis) assert.notEqual(groupOf(f.homeTeamId), groupOf(f.awayTeamId));
  assert.equal(plan.virtual.find((f) => f.id === 'finals-sf1').awayPlaceholder, 'Best runner-up');
});

test('4 groups, top 8: quarter-finals crossover, then semis and a final', () => {
  const event = ev({ id: 'q', groups: { count: 4 }, finals: { type: 'quarters' }, fixturesLockedAt: start });
  const entries = teams12.map((t, i) => entry(t, i));
  const plan = schedulePlan({ event, season, entries, fixtures: gf(event, drawGroups(event, teams12)), now: start });
  const ko = plan.virtual.filter((f) => f.stage === 'playoffs');
  assert.deepEqual(ko.map((f) => f.id), ['finals-qf1', 'finals-qf2', 'finals-qf3', 'finals-qf4', 'finals-sf1', 'finals-sf2', 'finals-final']);
  assert.deepEqual([ko[0].homePlaceholder, ko[0].awayPlaceholder], ['Winner Group A', 'Runner-up Group D']);
  assert.equal(ko[4].homePlaceholder, 'Winner QF1');
});

test('the draw is saved at the lock', () => {
  const event = gev();
  const plan = schedulePlan({ event, season, entries: teams12.map((t, i) => entry(t, i)), now: start });
  const saved = drawToSave(plan);
  assert.equal(Object.keys(saved).length, 12);
  assert.deepEqual(drawGroups({ ...event, groups: { count: 3, assign: saved } }, teams12), plan.groups);
  assert.equal(drawToSave(schedulePlan({ event: ev(), season, entries: [], now: 0 })), null);
});
