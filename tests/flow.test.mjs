import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventPhase, matchState, finalsOpenToSave, liveSummary, startAt, flowOf } from '../public/js/rules/flow.js';

const MIN = 60000;
const T0 = Date.UTC(2026, 9, 24, 7, 0); // the start

// A, B, C, D round robin (round 1: A-B, C-D; round 2: A-C, B-D), then a final.
const fx = (id, home, away, order, extra = {}) => ({ id, homeTeamId: home, awayTeamId: away, order, ...extra });
function bundle({ results = {}, submissions = [], flow, finals = true, date = T0, extraFixtures = [] } = {}) {
  return {
    event: { id: 'e', status: 'upcoming', date, finals: { type: finals ? 'final' : 'none' }, ...(flow ? { flow } : {}) },
    fixtures: [
      fx('r1-ab', 'A', 'B', 100), fx('r1-cd', 'C', 'D', 101),
      fx('r2-ac', 'A', 'C', 200), fx('r2-bd', 'B', 'D', 201),
      ...(finals ? [fx('finals-final', 'A', 'D', 0, { stage: 'playoffs' })] : []),
      ...extraFixtures,
    ],
    results,
    submissions,
  };
}
const res = (at) => ({ sets: [{ home: 10, away: 5 }, { home: 10, away: 5 }], enteredAt: at });

test('nothing opens before the start; an admin can open early', () => {
  const b = bundle();
  assert.equal(eventPhase(b, T0 - MIN).phase, 'before');
  assert.deepEqual(matchState(b, b.fixtures[0], T0 - MIN), { state: 'before', opensAt: T0 });
  const early = bundle({ flow: { openAt: T0 - 30 * MIN } });
  assert.equal(startAt(early.event), T0 - 30 * MIN);
  assert.equal(matchState(early, early.fixtures[0], T0 - 10 * MIN).state, 'open');
});

test('per team: the next match opens once both teams have finished their earlier ones', () => {
  const b = bundle({ results: { 'r1-ab': res(T0 + 15 * MIN) } });
  const now = T0 + 16 * MIN;
  assert.equal(matchState(b, b.fixtures[1], now).state, 'open'); // C-D still playing
  const ac = matchState(b, b.fixtures[2], now); // A is free, C is still playing C-D
  assert.equal(ac.state, 'waiting');
  assert.deepEqual(ac.waitingOn.map((w) => [w.teamId, w.fixture.id]), [['C', 'r1-cd']]);
  b.results['r1-cd'] = res(T0 + 20 * MIN);
  const open = matchState(b, b.fixtures[2], T0 + 21 * MIN);
  assert.equal(open.state, 'open');
  assert.equal(open.since, T0 + 20 * MIN); // opened when the later of the two finished
});

test('break after the group stage, then finals open by themselves (or wait for an admin)', () => {
  const all = { 'r1-ab': res(T0 + 10 * MIN), 'r1-cd': res(T0 + 12 * MIN), 'r2-ac': res(T0 + 30 * MIN), 'r2-bd': res(T0 + 33 * MIN) };
  const b = bundle({ results: { ...all } });
  const final = b.fixtures.find((f) => f.id === 'finals-final');
  const brk = eventPhase(b, T0 + 40 * MIN);
  assert.equal(brk.phase, 'break');
  assert.equal(brk.breakEndsAt, T0 + 48 * MIN); // 15 min after the last group score
  assert.equal(matchState(b, final, T0 + 40 * MIN).state, 'break');
  assert.equal(finalsOpenToSave(b, T0 + 40 * MIN), T0 + 48 * MIN);
  assert.equal(eventPhase(b, T0 + 48 * MIN).phase, 'finals');
  assert.equal(matchState(b, final, T0 + 49 * MIN).state, 'open');
  // Admin-only break: no timer until an admin opens them.
  const manual = bundle({ results: { ...all }, flow: { breakMinutes: null } });
  assert.equal(eventPhase(manual, T0 + 300 * MIN).phase, 'break');
  assert.equal(finalsOpenToSave(manual, T0 + 300 * MIN), null);
  const opened = bundle({ results: { ...all }, flow: { breakMinutes: null, finalsOpenAt: T0 + 35 * MIN } });
  assert.equal(eventPhase(opened, T0 + 36 * MIN).phase, 'finals');
  // Final played: done.
  const done = bundle({ results: { ...all, 'finals-final': res(T0 + 70 * MIN) } });
  assert.equal(eventPhase(done, T0 + 71 * MIN).phase, 'done');
});

test('no finals: done after the last group match; unsaved drafts keep it in the group stage', () => {
  const all = { 'r1-ab': res(T0), 'r1-cd': res(T0), 'r2-ac': res(T0), 'r2-bd': res(T0) };
  assert.equal(eventPhase(bundle({ results: all, finals: false }), T0 + MIN).phase, 'done');
  const drafts = bundle({ date: null, finals: true, results: all, extraFixtures: [fx('auto-r3-ad', 'A', 'D', 300, { virtual: true })] });
  assert.equal(eventPhase(drafts, T0).phase, 'groups');
});

test('paused stops everything; flow off keeps the old behaviour', () => {
  const p = bundle({ flow: { paused: true } });
  assert.equal(matchState(p, p.fixtures[0], T0 + MIN).state, 'paused');
  const off = bundle({ flow: { on: false } });
  assert.equal(flowOf(off.event), null);
  assert.equal(matchState(off, off.fixtures[2], T0 - 60 * MIN).state, 'open');
});

test('stuck matches: disputed or one-sided votes for 10 minutes, or no votes for 30', () => {
  const vote = (team, home, at) => ({ fixtureId: 'r1-ab', teamId: team, sets: [{ home, away: 5 }, { home: 10, away: 5 }], updatedAt: at });
  const disputed = bundle({ submissions: [vote('A', 10, T0 + 15 * MIN), vote('B', 12, T0 + 16 * MIN)] });
  assert.equal(matchState(disputed, disputed.fixtures[0], T0 + 20 * MIN).stuck, null);
  assert.equal(matchState(disputed, disputed.fixtures[0], T0 + 26 * MIN).stuck, 'disputed');
  const oneSide = bundle({ submissions: [vote('A', 10, T0 + 15 * MIN)] });
  assert.equal(matchState(oneSide, oneSide.fixtures[0], T0 + 25 * MIN).stuck, 'waiting');
  const silent = bundle();
  assert.equal(matchState(silent, silent.fixtures[0], T0 + 29 * MIN).stuck, null);
  assert.equal(matchState(silent, silent.fixtures[0], T0 + 30 * MIN).stuck, 'no-votes');
  const live = liveSummary(silent, T0 + 30 * MIN);
  assert.equal(live.phase, 'groups');
  assert.deepEqual(live.open.map((f) => f.id), ['r1-ab', 'r1-cd']);
  assert.equal(live.stuck.length, 2);
});
