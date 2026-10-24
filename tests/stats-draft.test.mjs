import test from 'node:test';
import assert from 'node:assert/strict';
import { teamOf, draftSummary, playerStatsFromDraft } from '../public/js/rules/stats-draft.js';

const keys = ['pts', 'spk'];
const ctx = {
  homeTeamId: 'reef', awayTeamId: 'tide',
  playersById: { a: { teamId: 'reef' }, b: { teamId: 'tide' }, m: { teamId: 'other' }, x: { teamId: 'other' } },
  rosters: { tide: { playerIds: ['m'] } },
};

test('team: the club, or the event roster for mix teams', () => {
  assert.equal(teamOf('a', ctx), 'reef');
  assert.equal(teamOf('m', ctx), 'tide');
  assert.equal(teamOf('x', ctx), null);
});

test('summary: confirmed, fixed and unsure lines; unknown names; players from elsewhere', () => {
  const result = { statsDraft: { rows: [
    { name: 'Ari', playerId: 'a', stats: { pts: { value: 12, sure: true }, spk: { value: 3, sure: false } } },
    { name: 'Ben', playerId: 'b', confirmedBy: '1', editedBy: '1', stats: { pts: { value: 9, sure: true }, spk: null } },
    { name: 'AD', playerId: null, stats: { pts: { value: 17 } } },
    { name: 'So', playerId: null, stats: { pts: { value: 0 } } },
    { name: 'BOT', notPlayer: true },
    { name: 'Xi', playerId: 'x', stats: {} },
  ] } };
  const s = draftSummary(result, ctx, keys);
  assert.equal(s.total, 2);
  assert.equal(s.confirmed, 1);
  assert.deepEqual(s.unknown, ['AD']);
  assert.deepEqual(s.offTeam, ['x']);
  assert.deepEqual(s.lines[0], { playerId: 'a', teamId: 'reef', name: 'Ari', stats: { pts: 12, spk: 3 }, confirmed: false, edited: false, unsure: true });
  assert.equal(s.lines[1].edited, true);
  assert.deepEqual(playerStatsFromDraft(s, keys), { a: { teamId: 'reef', pts: 12, spk: 3 }, b: { teamId: 'tide', pts: 9, spk: 0 } });
});
