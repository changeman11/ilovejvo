import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPings, chunks } from '../src/logic/event-pings.js';

const H = 3600e3;
const A = '111111111111111111';
const B = '222222222222222222';
const C = '333333333333333333';
const start = 10 * 24 * H;
const ctx = (extra = {}) => ({
  event: { id: 'ev', title: 'Night', published: true, status: 'upcoming', date: start, teamSize: 3, subs: 1, flow: { readyUp: true }, ...extra },
  teamIds: ['reef', 'tide'],
  teams: new Map([['reef', { name: 'Reef' }], ['tide', { name: 'Tide' }]]),
  players: new Map([['a', { teamId: 'reef', discordId: A }], ['b', { teamId: 'reef', discordId: B }], ['c', { teamId: 'tide', discordId: C }], ['d', { teamId: 'tide' }], ['e', { teamId: 'tide' }]]),
  rosters: {},
  checkins: [],
});

test('roster reminders: 24 h and 2 h before, only clubs short of players, once each', () => {
  const sent = new Set();
  const p = planPings({ events: [ctx()], now: start - 20 * H, sent, siteUrl: 'https://s' });
  assert.equal(p.length, 1);
  assert.equal(p[0].kind, 'roster24');
  assert.match(p[0].content, /Reef\*\* 2\/3/);
  assert.doesNotMatch(p[0].content, /Tide/, 'Tide has 3: not pinged');
  assert.deepEqual(p[0].userIds, [A, B]);
  sent.add(p[0].key);
  assert.equal(planPings({ events: [ctx()], now: start - 19 * H, sent }).length, 0, 'once');
  assert.equal(planPings({ events: [ctx()], now: start - H, sent })[0].kind, 'roster2');
});

test('at the start: everyone told to check in; 10 minutes in: only those still out', () => {
  const p = planPings({ events: [ctx()], now: start + 60e3, sent: new Set(['ev:roster24', 'ev:roster2']) });
  assert.equal(p[0].kind, 'start');
  assert.match(p[0].content, /Check in now/);
  assert.deepEqual(p[0].userIds.sort(), [A, B, C].sort());
  const later = ctx();
  later.checkins = [{ playerId: 'a' }, { playerId: 'c' }];
  const q = planPings({ events: [later], now: start + 11 * 60e3, sent: new Set(['ev:roster24', 'ev:roster2', 'ev:start']) });
  assert.equal(q[0].kind, 'checkin2');
  assert.deepEqual(q[0].userIds, [B]);
  // No check-in: "matches are open", and no reminder.
  const open = planPings({ events: [ctx({ flow: {} })], now: start + 60e3, sent: new Set(['ev:roster24', 'ev:roster2']) });
  assert.match(open[0].content, /first matches are open/);
});

test('missed windows and TBD events are skipped; long messages split at lines', () => {
  assert.equal(planPings({ events: [ctx()], now: start + 2 * H, sent: new Set() }).filter((x) => x.content).length, 0);
  assert.equal(planPings({ events: [ctx({ timeTbd: true })], now: start - H, sent: new Set() }).length, 0);
  const long = Array.from({ length: 100 }, (_, i) => `line ${i} ${'x'.repeat(40)}`).join('\n');
  const parts = chunks(long);
  assert.ok(parts.length > 1 && parts.every((x) => x.length <= 1900));
  assert.equal(parts.join('\n'), long);
});

test('subs on the event roster are pinged too (club players + roster)', () => {
  const c = ctx();
  c.players.set('s', { teamId: null, discordId: '444444444444444444' });
  c.rosters = { reef: { playerIds: ['s'] } };
  const p = planPings({ events: [c], now: start + 60e3, sent: new Set(['ev:roster24', 'ev:roster2']) });
  assert.ok(p[0].userIds.includes('444444444444444444'));
  assert.ok(p[0].userIds.includes(A));
});

test('🎟️ Event Player: clubs in the event, roster subs and solos; not pre-launch or long-finished events', async () => {
  const { eventPlayerIds } = await import('../src/event-role.js');
  const players = new Map([['a', { teamId: 'reef', discordId: A }], ['s', { discordId: B }], ['solo', { discordId: C }], ['x', { teamId: 'other', discordId: '444444444444444444' }]]);
  const teams = new Map([['reef', { name: 'Reef' }], ['other', { name: 'Other' }]]);
  const now = 3e12;
  const ev = (extra) => ({ event: { id: 'e', published: true, status: 'upcoming', date: now + 3600e3, ...extra }, teamIds: ['reef'], rosters: { reef: { playerIds: ['s'] } }, soloIds: ['solo'] });
  assert.deepEqual([...eventPlayerIds({ events: [ev({})], teams, players, now })].sort(), [A, B, C].sort());
  assert.equal(eventPlayerIds({ events: [ev({ date: 1000 })], teams, players, now }).size, 0, 'pre-launch');
  assert.equal(eventPlayerIds({ events: [ev({ date: now - 13 * 3600e3 })], teams, players, now }).size, 0, 'started over 12 h ago');
  assert.equal(eventPlayerIds({ events: [ev({ status: 'finished' })], teams, players, now }).size, 0);
});

test('missing stats nudges: no screenshot (5 min in, twice max), unreadable screenshot (once per picture)', async () => {
  const { statsNudgeDue, statsStillMissing, statsNudgeText } = await import('../src/logic/matches.js');
  const M = 60e3;
  const result = { sets: [{ home: 10, away: 5 }], statsStatus: 'pending', playerStats: {} };
  const t = { doneAt: 0 };
  assert.equal(statsNudgeDue({ result, subs: [], thread: t, now: 3 * M }), null, 'not before 5 minutes');
  const first = statsNudgeDue({ result, subs: [], thread: t, now: 6 * M });
  assert.deepEqual(first, { kind: 'noShot', n: 1 });
  assert.equal(statsNudgeDue({ result, subs: [], thread: { doneAt: 0, shotNudges: 1, shotNudgedAt: 6 * M }, now: 20 * M }), null, 'waits 45 minutes');
  assert.equal(statsNudgeDue({ result, subs: [], thread: { doneAt: 0, shotNudges: 1, shotNudgedAt: 6 * M }, now: 52 * M }).n, 2);
  assert.equal(statsNudgeDue({ result, subs: [], thread: { doneAt: 0, shotNudges: 2, shotNudgedAt: 0 }, now: 200 * M }), null, 'twice at most');
  const unread = { ...result, statsDraft: { shot: 'players/p/shot/a.png', error: 'no table found' } };
  assert.equal(statsNudgeDue({ result: unread, subs: [], thread: t, now: M }).kind, 'unread');
  assert.equal(statsNudgeDue({ result: unread, subs: [], thread: { doneAt: 0, unreadNudged: 'players/p/shot/a.png' }, now: M }), null);
  assert.equal(statsNudgeDue({ result: { ...result, statsStatus: 'reviewed' }, subs: [], thread: t, now: 10 * M }), null, 'stats done');
  assert.equal(statsNudgeDue({ result: { ...result, threadShots: ['players/p/shot/x.png'] }, subs: [], thread: t, now: 10 * M }), null, 'has a screenshot');
  assert.equal(statsStillMissing({ result, subs: [], thread: t, now: 60 * M }), true, 'thread stays open');
  assert.equal(statsStillMissing({ result, subs: [], thread: t, now: 200 * M }), false, 'but not for ever');
  const text = statsNudgeText(first, { ids: ['111111111111111111'], link: 'https://s/m' });
  assert.match(text, /^😤 <@111111111111111111>\nOi! no end-of-match screenshot/);
  assert.match(text, /Fix this result.*https:\/\/s\/m/);
});
