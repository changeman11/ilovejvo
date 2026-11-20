import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutOrder, needsOrdering, planDividers, DIVIDERS } from '../src/logic/role-layout.js';
import { RoleLayout } from '../src/role-layout.js';
import { transferPost, toPost, colorOf } from '../src/logic/transfer-hub.js';
import { TransferHub } from '../src/transfer-hub.js';
import { FileStore } from '../src/store/file-store.js';

const quiet = { info() {}, warn() {}, error() {} };

test('role order: TEAM divider, clubs, Captain, AWARDS divider, awards', () => {
  assert.deepEqual(layoutOrder({ teamDivider: 'T', clubIds: ['c1', 'c2'], captainId: 'cap', awardsDivider: 'A', awardIds: ['a1'] }), ['T', 'c1', 'c2', 'cap', 'A', 'a1']);
  const at = (o) => new Map(Object.entries(o).map(([k, p]) => [k, { position: p }]));
  assert.equal(needsOrdering(at({ T: 9, c1: 8, A: 7 }), ['T', 'c1', 'A'], 10), false);
  assert.equal(needsOrdering(at({ T: 9, c1: 5, A: 7 }), ['T', 'c1', 'A'], 10), true);
});

test('dividers go to whoever has a role in their section, and come off when they don’t', () => {
  const members = [
    { id: 'u1', roles: new Set(['club']) },
    { id: 'u2', roles: new Set(['award', 'AW']) },
    { id: 'u3', roles: new Set(['TM']) },
  ];
  const plan = planDividers({ members, sections: [{ dividerId: 'TM', roleIds: ['club'] }, { dividerId: 'AW', roleIds: ['award'] }] });
  assert.deepEqual(plan.add, [{ userId: 'u1', roleId: 'TM' }]);
  assert.deepEqual(plan.remove, [{ userId: 'u3', roleId: 'TM' }]);
});

test('role layout runner: makes the dividers once, orders roles, hands dividers out', async () => {
  const roles = new Map([['club1', { name: 'Reef', color: 1 }], ['p1', { name: '🥇', color: 0 }]]);
  const pos = { club1: 3, p1: 8 };
  let n = 0;
  let raised = null;
  const given = [];
  const io = {
    async roles() { return new Map(roles); },
    async createRole(r) { const id = `d${++n}`; roles.set(id, r); pos[id] = 1; return id; },
    async editRole() {},
    async positions() { return { roles: new Map(Object.entries(pos).map(([k, p]) => [k, { position: p }])), botTop: 20 }; },
    async raiseRoles(ids) { raised = ids; ids.forEach((id, i) => { pos[id] = 19 - i; }); },
    async allMembers() { return [{ id: 'u1', roles: new Set(['club1', 'p1']) }]; },
    async addRole(u, r) { given.push(r); },
    async removeRole() {},
  };
  const store = new FileStore();
  await store.setMeta('clubRoles', { reef: 'club1' });
  await store.setMeta('statRoles', { 'pts:1': 'p1' });
  const layout = new RoleLayout({ io, store, config: {}, log: quiet });
  const out = await layout.sync();
  assert.equal(out.made, 2);
  const d = store.getMeta('dividerRoles');
  assert.equal(roles.get(d.team).name, DIVIDERS.team);
  assert.deepEqual(raised, [d.team, 'club1', d.awards, 'p1']);
  assert.deepEqual(given.sort(), [d.awards, d.team].sort());
  const again = await layout.sync();
  assert.equal(again.made, 0);
  assert.equal(again.moved, false, 'already in order');
});

const players = new Map([['p', { displayName: 'Zuza', avatarUrl: 'https://cdn.discordapp.com/a.png' }]]);
const teams = new Map([['reef', { name: 'Reef Raiders', colors: { primary: '#1438d8' }, logoPath: 'teams/reef/logo/x.webp' }], ['tide', { name: 'Tide', colors: { primary: '#000000' } }]]);

test('transfer posts: wording, club colour and logo, links', () => {
  const post = transferPost({ id: 't', playerId: 'p', fromTeamId: 'tide', toTeamId: 'reef', kind: 'joined', at: 0 }, { players, teams, siteUrl: 'https://site', bucket: 'b' });
  const e = post.embeds[0];
  assert.equal(e.title, '📥 Signed');
  assert.equal(e.description, '**Zuza** joined **Reef Raiders** from **Tide**.');
  assert.equal(e.color, 0x1438d8);
  assert.match(e.thumbnail.url, /teams%2Freef%2Flogo/);
  assert.equal(e.author.icon_url, 'https://cdn.discordapp.com/a.png');
  assert.deepEqual(post.components[0].components.map((c) => c.url), ['https://site/player/p', 'https://site/team/reef']);
  assert.deepEqual(post.allowed_mentions, { parse: [] });
  assert.equal(transferPost({ playerId: 'p', fromTeamId: 'tide', kind: 'left' }, { players, teams }).embeds[0].color, 0x3b3b3b, 'black club shows dark grey');
  assert.match(transferPost({ playerId: 'p', fromTeamId: 'tide', kind: 'disbanded' }, { players, teams }).embeds[0].description, /Tide\*\* has disbanded/);
  assert.equal(colorOf(null), 0x1438d8);
  assert.deepEqual(toPost([{ id: 'b', data: { at: 2 } }, { id: 'a', data: { at: 1 } }, { id: 'c', data: { at: 3 } }], new Set(['c'])).map((t) => t.id), ['a', 'b']);
});

test('transfer hub: backfills a few the first time, then only new ones, never twice', async () => {
  const transfers = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, data: { playerId: 'p', toTeamId: 'reef', kind: 'joined', at: i, updatedAt: i } }));
  const posted = [];
  let now = 100;
  const site = {
    async list(c) { return c === 'transfers' ? transfers : c === 'players' ? [...players].map(([id, data]) => ({ id, data })) : [...teams].map(([id, data]) => ({ id, data })); },
    async changedSince(c, ms) { return transfers.filter((t) => t.data.updatedAt > ms); },
  };
  const store = new FileStore();
  const hub = new TransferHub({ io: { async post(b) { posted.push(b); } }, site, store, config: {}, log: quiet, now: () => now });
  assert.equal(await hub.sync(), 8, 'the last 8 to start');
  assert.equal(posted.length, 8);
  assert.equal(await hub.sync(), 0, 'nothing new');
  transfers.push({ id: 'new', data: { playerId: 'p', fromTeamId: 'reef', kind: 'left', at: 200, updatedAt: 200 } });
  now = 300;
  assert.equal(await hub.sync(), 1);
  assert.equal(posted.at(-1).embeds[0].title, '📤 Left');
  assert.equal(await hub.sync(), 0);
});

test('a leave message shows as a quote under the news', () => {
  const post = transferPost({ playerId: 'p', fromTeamId: 'reef', kind: 'left', note: 'Thanks for the games @everyone' }, { players, teams });
  assert.equal(post.embeds[0].description, '**Zuza** left **Reef Raiders** and is now a free agent.\n> Thanks for the games @​everyone\n> — Zuza');
});

test('staff desk cards: clubs, characters, fixes and a stats count; buttons only where they apply', async () => {
  const { deskCards, deskMessage, shortKey } = await import('../src/logic/staff-desk.js');
  const cards = deskCards({
    teams, players, siteUrl: 'https://site', bucket: 'b',
    pendingTeams: [{ id: 'new', data: { name: 'New FC', managerPlayerId: 'p', invitePlayerIds: [] } }],
    characters: [{ id: 'discord-1-0', data: { path: 'characters/x.png', author: 'Ann' } }],
    fixes: [
      { eventId: 'e', id: 'f1__p', data: { playerId: 'p', teamId: 'reef', sets: [{ home: 10, away: 8 }, { home: 10, away: 5 }] }, fixture: { id: 'f1', homeTeamId: 'reef', awayTeamId: 'tide' }, result: { sets: [{ home: 8, away: 10 }, { home: 10, away: 5 }, { home: 10, away: 7 }] }, event: { title: 'Night' } },
      { eventId: 'e', id: 'f2__p', data: { playerId: 'p', teamId: 'reef', sets: [], note: 'my stats are wrong' }, fixture: { id: 'f2', homeTeamId: 'reef', awayTeamId: 'tide' }, result: { sets: [] }, event: {} },
    ],
    statsWaiting: 3,
  });
  assert.deepEqual([...cards.keys()], ['team:new', 'char:discord-1-0', 'fix:e/f1__p', 'fix:e/f2__p', 'stats']);
  assert.equal(cards.get('fix:e/f1__p').yes, '✅ Use this score');
  assert.equal(cards.get('fix:e/f2__p').yes, null, 'no new score: only Close');
  const msg = deskMessage(cards.get('team:new'), shortKey('team:new'));
  assert.deepEqual(msg.components[0].components.map((c) => c.label), ['✅ Approve', '❌ Decline', 'Requests']);
  const done = deskMessage(cards.get('team:new'), 'x', { text: '✅ Approved by Sam' });
  assert.deepEqual(done.components[0].components.map((c) => c.label), ['Requests'], 'decided: buttons gone');
  assert.equal(done.embeds[0].footer.text, '✅ Approved by Sam');
});

test('staff desk: approving a club saves it, its founder, the news and invites in one go; non-staff can’t', async () => {
  const { StaffDesk } = await import('../src/staff-desk.js');
  const commits = [];
  const docs = {
    'teams/new': { name: 'New FC', status: 'pending', managerPlayerId: 'p', managerUid: 'uidP', invitePlayerIds: ['q', 'r'] },
    'players/q': { uid: 'uidQ', teamId: null },
    'players/r': { uid: 'uidR', teamId: 'reef' },
  };
  const rest = { uid: 'bot', async token() {}, async get(p) { return docs[p] ?? null; }, async commit(w) { commits.push(w); } };
  const store = new FileStore();
  await store.setMeta('staffDesk', { abc: { key: 'team:new', messageId: 'm1', card: { embed: { title: 'x' } } } });
  const desk = new StaffDesk({ io: {}, site: {}, rest, store, config: {}, log: quiet });
  assert.equal((await desk.button('desk:yes:abc', { id: '1', name: 'Pat', isStaff: false })).reply, 'Only staff can use these.');
  const out = await desk.button('desk:yes:abc', { id: '1', name: 'Sam', isStaff: true });
  assert.match(out.done, /Approved New FC \(1 invite sent\)/);
  const paths = commits[0].map((w) => w.path.split('/')[0]);
  assert.deepEqual(paths.filter((p) => p !== 'auditLog'), ['teams', 'players', 'transfers', 'offers']);
  assert.equal(paths.filter((p) => p === 'auditLog').length, 4, 'an audit entry per change');
  assert.equal(commits[0][0].data.status, 'approved');
  assert.deepEqual(commits[0][0].mask, ['status', 'updatedBy']);
  assert.equal(store.getMeta('staffDesk').abc, undefined);
  assert.equal((await desk.button('desk:yes:abc', { id: '1', name: 'Sam', isStaff: true })).reply, 'That card is already dealt with.');
});
