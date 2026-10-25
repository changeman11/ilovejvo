import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statTotals, topFor, placesFor, wantedHolders, planHolders } from '../src/logic/stat-roles.js';
import { StatRoles } from '../src/stat-roles.js';
import { FileStore } from '../src/store/file-store.js';

const id = (n) => `1000000000000000${String(n).padStart(2, '0')}`; // pretend Discord IDs

test('totals add up across results; forfeits and pending results count nothing', () => {
  const t = statTotals([
    { playerStats: { a: { teamId: 'x', pts: 10, spk: 2 }, b: { pts: 4 } } },
    { playerStats: { a: { pts: 5 } } },
    { forfeit: { teamId: 'x' }, playerStats: { a: { pts: 99 } } },
    { statsStatus: 'pending', playerStats: {} },
  ]);
  assert.equal(t.get('a').pts, 15);
  assert.equal(t.get('a').spk, 2);
  assert.equal(t.get('b').pts, 4);
});

test('top 3: ties for 3rd all count, zero never does', () => {
  const totals = new Map([['a', { pts: 9 }], ['b', { pts: 7 }], ['c', { pts: 5 }], ['d', { pts: 5 }], ['e', { pts: 1 }], ['z', { pts: 0 }]]);
  assert.deepEqual(topFor(totals, 'pts'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(topFor(new Map([['z', { pts: 0 }]]), 'pts'), []);
  assert.deepEqual(topFor(new Map([['a', { blk: 2 }]]), 'blk', 3), ['a'], 'fewer than 3 players');
});

test('places: ties share a place and skip the next; only 1st to 3rd', () => {
  const t = new Map([['a', { pts: 9 }], ['b', { pts: 9 }], ['c', { pts: 5 }], ['d', { pts: 4 }], ['z', { pts: 0 }]]);
  assert.deepEqual(placesFor(t, 'pts'), [['a', 1], ['b', 1], ['c', 3]]);
  const u = new Map([['a', { pts: 9 }], ['b', { pts: 7 }], ['c', { pts: 5 }], ['d', { pts: 5 }], ['e', { pts: 1 }]]);
  assert.deepEqual(placesFor(u, 'pts'), [['a', 1], ['b', 2], ['c', 3], ['d', 3]]);
});

test('holders: only players with a Discord ID; one role per place; roles move when places change', () => {
  const players = new Map([['a', { discordId: id(1) }], ['b', { discordId: id(2) }], ['c', {}]]);
  const want = wantedHolders(new Map([['a', { pts: 3 }], ['b', { pts: 2 }], ['c', { pts: 9 }]]), players);
  assert.deepEqual([...want.get('pts:1')], [], 'c is 1st but has no Discord');
  assert.deepEqual([...want.get('pts:2')], [id(1)]);
  assert.deepEqual([...want.get('pts:3')], [id(2)]);
  assert.equal(want.get('spk:1').size, 0);
  const plan = planHolders({ before: { 'pts:2': [id(2), id(3)] }, want });
  assert.deepEqual(plan.add, [{ key: 'pts:2', userId: id(1) }, { key: 'pts:3', userId: id(2) }]);
  assert.deepEqual(plan.remove, [{ key: 'pts:2', userId: id(2) }, { key: 'pts:2', userId: id(3) }]);
});

test('stat roles end to end: made once, 1st/2nd/3rd given, moved when overtaken', async () => {
  const roleList = new Map();
  const members = new Map([[id(1), new Set()], [id(2), new Set()], [id(3), new Set()], [id(4), new Set()]]);
  let n = 0;
  const io = {
    async roles() { return new Map(roleList); },
    async createRole(r) { const rid = `r${++n}`; roleList.set(rid, r); return rid; },
    async editRole(rid, r) { roleList.set(rid, r); },
    async addRole(u, r) { members.get(u).add(r); },
    async removeRole(u, r) { members.get(u).delete(r); },
  };
  const results = [{ playerStats: { a: { pts: 9 }, b: { pts: 7 }, c: { pts: 5 }, d: { pts: 1 } } }];
  const site = {
    async query() { return [{ id: 'night', data: { published: true } }]; },
    async list(path) {
      if (path === 'players') return ['a', 'b', 'c', 'd'].map((p, i) => ({ id: p, data: { discordId: id(i + 1) } }));
      return results.map((data, i) => ({ id: `f${i}`, data }));
    },
  };
  const store = new FileStore();
  const roles = new StatRoles({ io, site, store, config: { statRolesMinutes: 30, statRolesTop: 3 }, log: { info() {}, warn() {}, error() {} } });
  const first = await roles.sync();
  assert.equal(first.made, 24, 'three roles per stat');
  const map = store.getMeta('statRoles');
  const [p1, p2, p3] = [map['pts:1'], map['pts:2'], map['pts:3']];
  assert.equal(roleList.get(p1).name, '🥇 1st · Point Machine 👑');
  assert.equal(roleList.get(p2).name, '🥈 2nd · Point Machine 👑');
  assert.equal(roleList.get(p3).name, '🥉 3rd · Point Machine 👑');
  assert.equal(roleList.get(p1).color, 0xffc533);
  assert.equal(roleList.get(p1).color2, undefined, 'no gradient unless the server has enhanced role colours');
  assert.equal(roleList.get(p1).emoji, undefined, 'no role icon unless the server has role icons');
  assert.ok(members.get(id(1)).has(p1) && members.get(id(2)).has(p2) && members.get(id(3)).has(p3));
  assert.equal(members.get(id(1)).size, 1, 'only their own place');
  assert.equal(members.get(id(4)).size, 0);

  // d scores big: d is 1st, a 2nd, b 3rd, c drops out.
  results.push({ playerStats: { d: { pts: 20 } } });
  const second = await roles.sync();
  assert.equal(second.made, 0);
  assert.deepEqual([...members.get(id(4))], [p1]);
  assert.deepEqual([...members.get(id(1))], [p2]);
  assert.deepEqual([...members.get(id(2))], [p3]);
  assert.equal(members.get(id(3)).size, 0, 'taken off whoever drops out');
  assert.equal(roleList.size, 24, 'no extra roles');
});

test('stat roles: gradient and role icon where the server has them; old roles restyled once', async () => {
  const roleList = new Map([['old', { name: '💥 Spike Royalty · Top 3 ✨', color: 0xffc533 }]]);
  let n = 0;
  let edits = 0;
  const io = {
    async features() { return ['ROLE_ICONS', 'ENHANCED_ROLE_COLORS']; },
    async roles() { return new Map(roleList); },
    async createRole(r) { const rid = `r${++n}`; roleList.set(rid, r); return rid; },
    async editRole(rid, r) { edits++; roleList.set(rid, r); },
    async addRole() {}, async removeRole() {},
  };
  const site = { async query() { return []; }, async list() { return []; } };
  const store = new FileStore();
  await store.setMeta('statRoles', { spk: 'old' });
  await store.setMeta('statRoleHolders', { spk: ['someone'] });
  const roles = new StatRoles({ io, site, store, config: { statRolesMinutes: 30, statRolesTop: 3 }, log: { info() {}, warn() {}, error() {} } });
  await roles.sync();
  const spk = roleList.get('old');
  assert.equal(spk.name, '🥇 1st · Spike Royalty 💥', 'the old Top 3 role becomes 1st place, renamed, not remade');
  assert.equal(store.getMeta('statRoles')['spk:1'], 'old');
  assert.equal(store.getMeta('statRoles').spk, undefined);
  assert.equal(spk.color2, 0xff9a3c);
  assert.equal(spk.emoji, '💥');
  assert.equal(roleList.get(store.getMeta('statRoles')['spk:2']).emoji, '🥈', '2nd and 3rd use the medal as icon');
  assert.deepEqual(store.getMeta('statRoleHolders')['spk:1'], [], 'old holders are checked again (and lose it here)');
  assert.equal(edits, 1);
  await roles.sync();
  assert.equal(edits, 1, 'restyled once, not every check');
});
