import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eligibleClubs, colorNumber, planRoles, wantedClub, planMembers } from '../src/logic/club-roles.js';
import { ClubRoles } from '../src/club-roles.js';
import { FileStore } from '../src/store/file-store.js';

const A = '111111111111111111';
const B = '222222222222222222';
const C = '333333333333333333';
const D = '444444444444444444';

test('only approved, non-mix clubs with a name get a role; colours read from the site', () => {
  const teams = new Map([
    ['reef', { name: 'Reef Raiders', colors: { primary: '#1438d8' }, status: 'approved' }],
    ['old', { name: 'Old Club', colors: { primary: 'red' } }],
    ['pend', { name: 'Pending FC', status: 'pending' }],
    ['gone', { name: 'Gone', status: 'disbanded' }],
    ['mix', { name: 'Mix 1', mix: true, status: 'approved' }],
    ['blank', { name: '  ' }],
  ]);
  const clubs = eligibleClubs(teams);
  assert.deepEqual([...clubs.keys()], ['reef', 'old']);
  assert.deepEqual(clubs.get('reef'), { name: 'Reef Raiders', color: 0x1438d8 });
  assert.equal(clubs.get('old').color, 0, 'not a hex colour: no colour');
  assert.equal(colorNumber('ffe200'), 0xffe200);
});

test('roles: make missing ones, fix changed ones, delete ones for clubs that are gone', () => {
  const clubs = new Map([
    ['reef', { name: 'Reef Raiders', color: 1 }],
    ['tide', { name: 'Tasman Tide', color: 2 }],
    ['new', { name: 'New Club', color: 3 }],
  ]);
  const roleMap = { reef: 'r1', tide: 'r2', gone: 'r3' };
  const existing = new Map([
    ['r1', { name: 'Reef Raiders', color: 1, hoist: true }],
    ['r2', { name: 'Tasman Tide (old name)', color: 2, hoist: true }],
    ['r3', { name: 'Gone', color: 0, hoist: true }],
  ]);
  const plan = planRoles({ clubs, roleMap, existing, hoist: true });
  assert.deepEqual(plan.create, ['new']);
  assert.deepEqual(plan.update, [{ teamId: 'tide', roleId: 'r2', name: 'Tasman Tide', color: 2 }]);
  assert.deepEqual(plan.remove, [{ teamId: 'gone', roleId: 'r3' }]);
});

test('members: right club role added, old club roles removed, other roles never touched', () => {
  const clubs = new Map([['reef', {}], ['tide', {}]]);
  const players = [
    { discordId: A, teamId: 'reef' },
    { discordId: B, teamId: 'tide' },
    { discordId: C, teamId: null },
    { discordId: 'not-an-id', teamId: 'reef' },
    { discordId: D, teamId: 'pending-club' },
  ];
  const want = wantedClub(players, clubs);
  assert.deepEqual([...want], [[A, 'reef'], [B, 'tide'], [C, null], [D, null]]);
  const roleMap = { reef: 'r1', tide: 'r2' };
  const memberRoles = new Map([
    [A, new Set(['mod'])],
    [B, new Set(['r1', 'r2'])],
    [C, new Set(['r2', 'mod'])],
    [D, null],
  ]);
  const plan = planMembers({ want, roleMap, memberRoles });
  assert.deepEqual(plan.add, [{ userId: A, roleId: 'r1' }]);
  assert.deepEqual(plan.remove, [{ userId: B, roleId: 'r1' }, { userId: C, roleId: 'r2' }]);
});

// ---------- the whole thing, with a pretend Discord and a pretend site ----------
class FakeDiscord {
  roleList = new Map([['mod', { name: 'Mod', color: 5, hoist: false }]]);
  members = new Map([[A, new Set(['mod'])], [B, new Set()], [C, new Set()]]); // D isn't in the server
  n = 0;
  async roles() { return new Map(this.roleList); }
  async createRole(r) { const id = `role${++this.n}`; this.roleList.set(id, { ...r }); return id; }
  async editRole(id, r) { this.roleList.set(id, { ...r }); }
  async deleteRole(id) { this.roleList.delete(id); for (const s of this.members.values()) s.delete(id); }
  async memberRoles(id) { return this.members.has(id) ? new Set(this.members.get(id)) : null; }
  async addRole(id, r) { this.members.get(id).add(r); }
  async removeRole(id, r) { this.members.get(id).delete(r); }
  roleNamed(name) { return [...this.roleList].find(([, r]) => r.name === name)?.[0]; }
}

class FakeSite {
  docs = {
    teams: new Map([
      ['reef', { name: 'Reef Raiders', colors: { primary: '#1438d8' }, status: 'approved', updatedAt: 1 }],
      ['tide', { name: 'Tasman Tide', colors: { primary: '#16b3a3' }, status: 'approved', updatedAt: 1 }],
    ]),
    players: new Map([
      ['dA', { discordId: A, teamId: 'reef', updatedAt: 1 }],
      ['dB', { discordId: B, teamId: 'tide', updatedAt: 1 }],
      ['dC', { discordId: C, teamId: null, updatedAt: 1 }],
      ['dD', { discordId: D, teamId: 'reef', updatedAt: 1 }],
    ]),
  };
  async list(c) { return [...this.docs[c]].map(([id, data]) => ({ id, data })); }
  async changedSince(c, ms) { return (await this.list(c)).filter((d) => d.data.updatedAt > ms); }
}

test('club roles end to end: made, coloured, grouped, given, moved and cleaned up', async () => {
  let t = 10_000_000;
  const discord = new FakeDiscord();
  const site = new FakeSite();
  const store = new FileStore();
  const roles = new ClubRoles({ io: discord, site, store, config: { clubRolesHoist: true, clubRolesMinutes: 5 }, log: { info() {}, warn() {}, error() {} }, now: () => t });

  const first = await roles.fullSync();
  assert.equal(first.created, 2);
  const reef = discord.roleNamed('Reef Raiders');
  const tide = discord.roleNamed('Tasman Tide');
  assert.deepEqual(discord.roleList.get(reef), { name: 'Reef Raiders', color: 0x1438d8, hoist: true });
  assert.deepEqual([...discord.members.get(A)].sort(), ['mod', reef].sort(), 'other roles are kept');
  assert.deepEqual([...discord.members.get(B)], [tide]);
  assert.deepEqual([...discord.members.get(C)], []);
  assert.equal(first.notInServer, 1, "D isn't in the Discord server");
  assert.deepEqual(store.getMeta('clubRoles'), { reef, tide });

  // Nothing changed: a quick check does nothing.
  t = 10_002_000;
  assert.equal(await roles.quickSync(), null);

  // B moves from Tide to Reef; Tide renames itself.
  t = 10_300_000;
  site.docs.players.set('dB', { discordId: B, teamId: 'reef', updatedAt: 10_250_000 });
  site.docs.teams.set('tide', { name: 'Tasman Tide FC', colors: { primary: '#16b3a3' }, status: 'approved', updatedAt: 10_250_000 });
  const moved = await roles.quickSync();
  assert.equal(moved.updated, 1);
  assert.deepEqual([...discord.members.get(B)], [reef]);
  assert.equal(discord.roleList.get(tide).name, 'Tasman Tide FC');

  // Reef disbands: its role is deleted (and goes from everyone with it).
  t = 10_600_000;
  site.docs.teams.set('reef', { name: 'Reef Raiders', status: 'disbanded', updatedAt: 10_550_000 });
  const gone = await roles.quickSync();
  assert.equal(gone.deleted, 1);
  assert.ok(!discord.roleList.has(reef));
  assert.deepEqual([...discord.members.get(A)], ['mod']);
  assert.deepEqual(store.getMeta('clubRoles'), { tide });

  // Someone deletes the Tide role by hand: the next full check makes it again and gives it back.
  discord.members.get(C).clear();
  site.docs.players.set('dC', { discordId: C, teamId: 'tide', updatedAt: 1 });
  await discord.deleteRole(tide);
  const again = await roles.fullSync();
  assert.equal(again.created, 1);
  assert.deepEqual([...discord.members.get(C)], [discord.roleNamed('Tasman Tide FC')]);
});
