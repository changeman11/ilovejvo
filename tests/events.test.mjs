import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventDateLabel, sortEvents, validateEvent, dateFromInputs, inputsFromDate, zoneLabel, countdownParts } from '../public/js/rules/events.js';

const base = { type: 'exhibition', title: 'Showmatch night', status: 'upcoming', summary: '', date: null };

test('no date shows Date TBD; date without time shows Time TBD', () => {
  assert.equal(eventDateLabel({ date: null }), 'Date TBD');
  const { date, timeTbd } = dateFromInputs('2026-11-14', '');
  assert.match(eventDateLabel({ date, timeTbd }, 'en-AU'), /14 Nov 2026 · Time TBD$/);
  const timed = dateFromInputs('2026-11-14', '19:30');
  assert.equal(timed.timeTbd, false);
  assert.match(eventDateLabel(timed, 'en-AU'), /7:30/);
});

test('form date round-trips; TBD time is stored at noon', () => {
  assert.deepEqual(dateFromInputs('', '19:00'), { date: null, timeTbd: true });
  const noon = dateFromInputs('2026-12-01', '');
  assert.equal(new Date(noon.date).getHours(), 12);
  assert.deepEqual(inputsFromDate(noon.date, true), { dateStr: '2026-12-01', timeStr: '' });
  const timed = dateFromInputs('2026-12-01', '08:05');
  assert.deepEqual(inputsFromDate(timed.date, false), { dateStr: '2026-12-01', timeStr: '08:05' });
  assert.deepEqual(inputsFromDate(null, true), { dateStr: '', timeStr: '' });
});

test('sorting: dated upcoming first, then TBD, then past', () => {
  const list = [
    { id: 'tbd-old', status: 'upcoming', date: null, createdAt: 1 },
    { id: 'later', status: 'upcoming', date: 300 },
    { id: 'done', status: 'finished', date: 50 },
    { id: 'soon', status: 'upcoming', date: 200 },
    { id: 'tbd-new', status: 'upcoming', date: null, createdAt: 2 },
    { id: 'off', status: 'cancelled', date: 80 },
  ];
  const { upcoming, past } = sortEvents(list);
  assert.deepEqual(upcoming.map((e) => e.id), ['soon', 'later', 'tbd-new', 'tbd-old']);
  assert.deepEqual(past.map((e) => e.id), ['off', 'done']);
});

test('validation', () => {
  assert.deepEqual(validateEvent(base), []);
  assert.equal(validateEvent({ ...base, title: '  ' }).length, 1);
  assert.equal(validateEvent({ ...base, type: 'party' }).length, 1);
  assert.equal(validateEvent({ ...base, streamUrl: 'javascript:alert(1)' }).length, 1);
  assert.deepEqual(validateEvent({ ...base, signupUrl: 'https://discord.gg/abc' }), []);
  assert.equal(validateEvent({ ...base, type: 'tournament', teamSize: 0 }).length, 1);
  assert.deepEqual(validateEvent({ ...base, type: 'tournament', teamSize: 4 }), []);
  assert.equal(validateEvent({ ...base, summary: 'x'.repeat(281) }).length, 1);
});

test('times name the viewer’s own time zone: AEDT / NZDT, or the city when the browser only knows GMT+11', () => {
  const ms = Date.UTC(2026, 9, 24, 7, 0); // 6:00 pm in Sydney, 8:00 pm in Auckland
  assert.equal(zoneLabel(ms, 'en-AU', 'Australia/Sydney'), 'AEDT');
  assert.equal(zoneLabel(ms, 'en-NZ', 'Pacific/Auckland'), 'NZDT');
  assert.equal(zoneLabel(ms, 'en-US', 'Australia/Sydney'), 'Sydney time');
  assert.equal(zoneLabel(ms, 'en-US', 'Australia/Lord_Howe'), 'Lord Howe time');
  assert.equal(zoneLabel(ms, 'en-US', 'UTC'), 'UTC');
  assert.match(eventDateLabel({ date: ms }, 'en-AU', 'Australia/Sydney'), /24 Oct 2026 · 6:00\s?pm AEDT$/iu);
  assert.match(eventDateLabel({ date: ms }, 'en-NZ', 'Pacific/Auckland'), /8:00\s?pm NZDT$/iu);
});

test('countdown: h:mm:ss under a day, days when further out, live once started', () => {
  const start = Date.UTC(2026, 9, 24, 7, 0);
  const under = countdownParts(start, start - (1 * 3600 + 39 * 60 + 12) * 1000);
  assert.equal(under.short, '1:39:12');
  assert.deepEqual(under.parts, [['01', 'hrs'], ['39', 'min'], ['12', 'sec']]);
  const days = countdownParts(start, start - (2 * 86400 + 4 * 3600 + 15 * 60) * 1000);
  assert.equal(days.short, '2d 04h 15m');
  assert.deepEqual(days.parts[0], [2, 'days']);
  assert.equal(countdownParts(start, start - 86400000).parts[0][1], 'day');
  assert.deepEqual(countdownParts(start, start + 1000), { live: true, parts: [], short: 'live now' });
});

test('club moves pause while an event is running: from the lock until it is done (12 h at most)', async () => {
  const { eventBlockingMoves } = await import('../public/js/rules/events.js');
  const start = Date.UTC(2026, 9, 24, 7, 0);
  const e = { id: 'n', published: true, status: 'upcoming', date: start };
  assert.equal(eventBlockingMoves([e], start - 11 * 60000), null, 'free until 10 minutes before');
  assert.equal(eventBlockingMoves([e], start - 9 * 60000), e);
  assert.equal(eventBlockingMoves([e], start + 3 * 3600000), e);
  assert.equal(eventBlockingMoves([e], start + 3 * 3600000, () => 'done'), null, 'free once every match is played');
  assert.equal(eventBlockingMoves([{ ...e, status: 'finished' }], start + 60000), null);
  assert.equal(eventBlockingMoves([e], start + 13 * 3600000), null, 'never stuck for more than 12 hours');
  assert.equal(eventBlockingMoves([{ ...e, published: false }], start), null);
  assert.equal(eventBlockingMoves([{ ...e, timeTbd: true }], start), null);
});
