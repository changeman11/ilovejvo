import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAUNCH_AT, isPreLaunch, liveBundles, preLaunchBundles } from '../public/js/rules/eras.js';
import { awardEvent, eventComplete, latestStatsEvent, hasStats, statsEvents } from '../public/js/rules/award-event.js';

const line = { teamId: 'A', pts: 5 };
const ev = (id, date, extra = {}) => ({ event: { id, title: id, published: true, status: 'upcoming', date: LAUNCH_AT + date, ...extra.event }, fixtures: extra.fixtures ?? [], results: extra.results ?? {}, teams: extra.teams ?? [] });
const played = { fixtures: [{ id: 'm1', homeTeamId: 'A', awayTeamId: 'B' }], results: { m1: { sets: [{ home: 10, away: 5 }, { home: 10, away: 6 }], playerStats: { p1: line } } }, teams: [{ id: 'A' }, { id: 'B' }] };

test('award event: the last event with stats; a newer event takes over as soon as it has stats', () => {
  const first = ev('first', 100, { event: { status: 'finished' }, results: { m1: { sets: [], playerStats: { p1: line } } } });
  const next = ev('next', 200, { fixtures: [{ id: 'm9', homeTeamId: 'A', awayTeamId: 'B' }] });
  assert.equal(awardEvent([first, next]).event.id, 'first', 'a newer event with no stats yet changes nothing');
  next.results = { m9: { sets: [], playerStats: { p1: line } } };
  assert.equal(awardEvent([first, next]).event.id, 'next', 'its first stats replace the old holders');
  assert.equal(latestStatsEvent([first, next]).event.id, 'next');
  assert.deepEqual(statsEvents([first, next]).map((b) => b.event.id), ['next', 'first'], 'newest first (the rest are the archive)');
  const done = ev('running', 200, played);
  assert.equal(eventComplete(done), true);
  // A finished event without stats, a cancelled or unpublished one: skipped.
  assert.equal(awardEvent([first, ev('nostats', 300, { event: { status: 'finished' } })]).event.id, 'first');
  assert.equal(awardEvent([first, ev('x', 300, { ...played, event: { status: 'cancelled' } })]).event.id, 'first');
  assert.equal(awardEvent([first, ev('y', 300, { ...played, event: { published: false } })]).event.id, 'first');
  assert.equal(awardEvent([]), null);
  assert.equal(hasStats(ev('f', 1, { results: { m: { forfeit: { teamId: 'A' }, playerStats: { p: line } } } })), false);
});

test('a knockout event completes only when its final is played', () => {
  const ko = ev('ko', 1, { event: { finals: { type: 'final' } }, ...played });
  assert.equal(eventComplete(ko), false);
  ko.fixtures.push({ id: 'finals-final', stage: 'playoffs', homeTeamId: 'A', awayTeamId: 'B' });
  ko.results['finals-final'] = { sets: [{ home: 5, away: 10 }, { home: 6, away: 10 }], playerStats: {} };
  assert.equal(eventComplete(ko), true);
});

test('pre-launch events are archived: no awards or live stats from them', () => {
  const old = { event: { id: 'old', title: 'old', published: true, date: LAUNCH_AT - 1000 }, fixtures: [], results: { m: { sets: [], playerStats: { p1: line } } }, teams: [] };
  const tbd = { event: { id: 'tbd', title: 'tbd', published: true, date: null, createdAt: LAUNCH_AT + 5 }, fixtures: [], results: {}, teams: [] };
  assert.equal(isPreLaunch(old.event), true);
  assert.equal(isPreLaunch(tbd.event), false, 'TBD events go by when they were made');
  assert.equal(isPreLaunch({ date: 0, era: 'live' }), false, 'an event can be marked live by hand');
  assert.equal(awardEvent([old]), null, 'awards reset at launch');
  assert.deepEqual(statsEvents([old], { preLaunch: true }).map((b) => b.event.id), ['old']);
  assert.deepEqual(liveBundles([old, tbd]).map((b) => b.event.id), ['tbd']);
  assert.deepEqual(preLaunchBundles([old, tbd]).map((b) => b.event.id), ['old']);
});
