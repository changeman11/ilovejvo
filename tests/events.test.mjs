import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventDateLabel, sortEvents, validateEvent, dateFromInputs, inputsFromDate } from '../public/js/rules/events.js';

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
