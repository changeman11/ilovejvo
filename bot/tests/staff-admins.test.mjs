import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planStaffAdmins, StaffAdmins } from '../src/staff-admins.js';

const id = (n) => `1000000000000000${String(n).padStart(2, '0')}`;

test('plan: Staff members get entries, ex-staff lose theirs, hand-made entries are left alone', () => {
  const existing = new Map([
    [`discord:${id(1)}`, { discord: true, source: 'staff-role', name: 'Old Name' }],
    [`discord:${id(2)}`, { discord: true, source: 'staff-role', name: 'Gone' }],
    [`discord:${id(3)}`, { discord: true, name: 'Owner (by hand)' }],
    ['passwordUid123', { name: 'admin' }],
  ]);
  const staff = [{ id: id(1), name: 'New Name' }, { id: id(3), name: 'Owner' }, { id: id(4), name: 'Fresh' }];
  const plan = planStaffAdmins({ staff, existing });
  assert.deepEqual(plan.add.map((m) => m.id), [id(4)]);
  assert.deepEqual(plan.rename.map((m) => m.id), [id(1)]);
  assert.deepEqual(plan.remove, [`discord:${id(2)}`], 'only the bot’s own entries are removed');
});

function world(staff, docs = []) {
  const store = new Map(docs.map((d) => [d.id, d.data]));
  const writes = [];
  const rest = {
    async list() { return [...store].map(([i, data]) => ({ id: i, data })); },
    async commit(ws) {
      for (const w of ws) {
        writes.push(w);
        if (w.delete) store.delete(w.delete.replace('admins/', ''));
        else store.set(w.path.replace('admins/', ''), w.data);
      }
    },
  };
  const s = new StaffAdmins({ io: { staffMembers: async () => staff }, rest, config: {}, log: { info() {}, warn() {} }, now: () => 5 });
  return { s, store, writes };
}

test('sync writes the entries the site rules expect', async () => {
  const w = world([{ id: id(5), name: 'Botty Binz' }]);
  await w.s.sync();
  assert.deepEqual(w.store.get(`discord:${id(5)}`), { discord: true, name: 'Botty Binz', source: 'staff-role', discordId: id(5), updatedBy: 'pickup-bot', updatedAt: 5 });
  assert.equal(w.writes[0].mustNotExist, true, 'never overwrites an entry made meanwhile');
});

test('a failed or empty member read never removes everyone', async () => {
  const docs = [{ id: `discord:${id(6)}`, data: { discord: true, source: 'staff-role', name: 'X' } }];
  const none = world(null, docs);
  assert.deepEqual(await none.s.sync(), { skipped: true });
  const empty = world([], docs);
  assert.deepEqual(await empty.s.sync(), { skipped: true });
  assert.ok(empty.store.has(`discord:${id(6)}`));
});
