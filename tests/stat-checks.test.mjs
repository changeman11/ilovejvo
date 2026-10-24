import test from 'node:test';
import assert from 'node:assert/strict';
import { statFlags, perSetHighs, lineLimit, DEFAULT_PER_SET } from '../public/js/rules/stat-checks.js';

const sets = [{ home: 10, away: 6 }, { home: 10, away: 8 }]; // reef won 20 points, tide 14
const playersById = {
  a: { id: 'a', displayName: 'Ari', discordId: '1', teamId: 'reef', gameNames: ['ari_gg'] },
  c: { id: 'c', displayName: 'Cap', discordId: '3', teamId: 'reef' },
  b: { id: 'b', displayName: 'Ben', discordId: '2', teamId: 'tide' },
};
const ctx = { sets, homeTeamId: 'reef', awayTeamId: 'tide', playersById, teamsById: { reef: { name: 'Reef' }, tide: { name: 'Tide' } } };
const line = (playerId, teamId, stats, extra = {}) => ({ playerId, teamId, name: playersById[playerId].displayName, stats: { pts: 0, spk: 0, rec: 0, ...stats }, ...extra });

test('a normal match has no warnings', () => {
  assert.deepEqual(statFlags([line('a', 'reef', { pts: 8, spk: 12, rec: 14 }), line('b', 'tide', { pts: 6, spk: 9, rec: 20 })], ctx), []);
});

test('unusually high numbers, scaled by the sets played', () => {
  assert.equal(lineLimit(DEFAULT_PER_SET, 'spk', 2), Math.ceil(11 * 2 * 1.2));
  const f = statFlags([line('a', 'reef', { pts: 9, spk: 40 })], ctx);
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, 'high');
  assert.match(f[0].text, /Ari: unusually high SPK 40 for 2 sets \(normal is up to 27 SPK\)/);
  // A three-setter allows more.
  const three = { ...ctx, sets: [...sets, { home: 12, away: 10 }] };
  assert.equal(statFlags([line('a', 'reef', { spk: 30 })], three).length, 0);
});

test('team PTS that add up to more than the points the team won', () => {
  const f = statFlags([line('b', 'tide', { pts: 12 }), line('b', 'tide', { pts: 9 })], ctx);
  assert.deepEqual(f.map((x) => x.kind), ['total']);
  assert.match(f[0].text, /Tide’s players have 21 PTS between them, but the team only won 14 points/);
  assert.equal(statFlags([line('b', 'tide', { pts: 15 })], ctx).length, 0, 'a point or two over is normal');
});

test('numbers changed by a captain or the player are flagged with what changed; staff edits are not', () => {
  const read = { pts: 4, spk: 6, rec: 10 };
  const byCap = statFlags([line('a', 'reef', { pts: 9, spk: 6, rec: 10 }, { editedBy: '3', editedAs: 'captain', readStats: read })], ctx);
  assert.equal(byCap[0].kind, 'edited');
  assert.equal(byCap[0].text, '👑 Captain Cap changed Ari’s numbers: PTS 4→9');
  const self = statFlags([line('a', 'reef', { pts: 4, spk: 6, rec: 11 }, { editedBy: '1', readStats: read })], ctx);
  assert.equal(self[0].text, 'Ari changed their own numbers: REC 10→11');
  assert.equal(statFlags([line('a', 'reef', { pts: 9 }, { editedBy: '9', editedAs: 'staff', readStats: read })], ctx).length, 0);
  assert.equal(statFlags([line('a', 'reef', read, { editedBy: '1', editedAs: 'self', readStats: read })], ctx).length, 0, 'retyped the same numbers');
  assert.match(statFlags([line('a', 'reef', { pts: 9 }, { editedBy: '3' })], ctx)[0].text, /Cap changed Ari’s numbers \(the screenshot’s numbers weren’t kept/);
});

test('a line named by hand is flagged only when the name on screen doesn’t look like the player', () => {
  const ok = statFlags([{ ...line('a', 'reef', {}), name: 'ari_gg', namedBy: '1' }], ctx);
  assert.equal(ok.length, 0);
  const odd = statFlags([{ ...line('a', 'reef', {}), name: 'xXSniperXx', namedBy: '1' }], ctx);
  assert.equal(odd[0].text, '“xXSniperXx” on screen was named as Ari by themself in Who’s who');
});

test('highs are learned from saved results once there are enough', () => {
  const few = Array.from({ length: 10 }, () => ({ stats: { spk: 2 }, sets: 2 }));
  assert.equal(perSetHighs(few, ['spk']).spk, DEFAULT_PER_SET.spk);
  const many = Array.from({ length: 100 }, (_, i) => ({ stats: { spk: i % 10 }, sets: 1 }));
  assert.equal(perSetHighs(many, ['spk']).spk, 9);
});
