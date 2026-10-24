import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statTotals, topFor, wantedHolders, planHolders } from '../src/logic/stat-roles.js';
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

test('holders: only players with a Discord ID; roles move when the top 3 changes', () => {
  const players = new Map([['a', { discordId: id(1) }], ['b', { discordId: id(2) }], ['c', {}]]);
  const want = wantedHolders(new Map([['a', { pts: 3 }], ['b', { pts: 2 }], ['c', { pts: 9 }]]), players);
  assert.deepEqual([...want.get('pts')].sort(), [id(1), id(2)].sort());
  assert.deepEqual(want.get('spk').size, 0);
  const plan = planHolders({ before: { pts: [id(1), id(3)] }, want });
  assert.deepEqual(plan.add, [{ key: 'pts', userId: id(2) }]);
  assert.deepEqual(plan.remove, [{ key: 'pts', userId: id(3) }]);
});

test('stat roles end to end: made once, given to the top 3, taken off when overtaken', async () => {
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
  assert.equal(first.made, 8, 'one role per stat');
  const pts = store.getMeta('statRoles').pts;
  assert.equal(roleList.get(pts).name, '🏆 Top 3 · Points');
  assert.ok(members.get(id(1)).has(pts) && members.get(id(2)).has(pts) && members.get(id(3)).has(pts));
  assert.ok(!members.get(id(4)).has(pts));

  // d scores big: c drops out of the top 3.
  results.push({ playerStats: { d: { pts: 20 } } });
  const second = await roles.sync();
  assert.equal(second.made, 0);
  assert.ok(members.get(id(4)).has(pts));
  assert.ok(!members.get(id(3)).has(pts), 'taken off whoever drops out');
  assert.equal(roleList.size, 8, 'no extra roles');
});
