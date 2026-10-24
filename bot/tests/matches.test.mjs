// Match threads (src/matches.js) with a pretend Discord, a pretend site and a pretend database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSets, readScore, reminderDue, profileOf, captainOf, toConfirm } from '../src/logic/matches.js';
import { MatchThreads } from '../src/matches.js';
import { DEFAULT_FORMAT } from '../src/site-rules/defaults.js';

const MIN = 60000;
const T0 = Date.UTC(2026, 9, 24, 7, 0); // the event starts
const ids = { a1: '100000000000000001', a2: '100000000000000002', b1: '200000000000000001', b2: '200000000000000002', x: '900000000000000009' };

test('typed set scores: separators, dashes, home first; checked against the format', () => {
  assert.deepEqual(parseSets('10-7, 8-10, 12-10').sets, [{ home: 10, away: 7 }, { home: 8, away: 10 }, { home: 12, away: 10 }]);
  assert.deepEqual(parseSets('10 7 / 10 8').sets, [{ home: 10, away: 7 }, { home: 10, away: 8 }]);
  assert.deepEqual(parseSets('10–4; 10:6').sets, [{ home: 10, away: 4 }, { home: 10, away: 6 }]);
  assert.match(parseSets('').error, /Type the set scores/);
  assert.match(parseSets('ten-seven').error, /isn't a set score/);
  assert.deepEqual(readScore('10-7, 10-8', DEFAULT_FORMAT).sets.length, 2);
  assert.match(readScore('10-9, 10-8', DEFAULT_FORMAT).error, /win by 2/);
  assert.match(readScore('10-7', DEFAULT_FORMAT).error, /isn't finished/);
});

test('who is who: profiles by Discord ID, captains by managerPlayerId or managerUid', () => {
  const players = [
    { id: 'old', discordId: ids.a1 },
    { id: 'dA1', discordId: ids.a1, uid: 'discord:a1', teamId: 'reef' },
  ];
  assert.equal(profileOf(ids.a1, players).id, 'dA1', 'the signed-in profile in a club wins');
  assert.equal(profileOf(ids.x, players), null);
  assert.equal(captainOf({ id: 'reef', managerPlayerId: 'dA1' }, players).id, 'dA1');
  assert.equal(captainOf({ id: 'reef', managerUid: 'discord:a1' }, players).id, 'dA1');
  assert.equal(captainOf({ id: 'tide', managerPlayerId: 'dA1' }, players), null, 'must still be in the club');
});

test('reminders: the team that has not voted, both when the scores clash, then admins once', () => {
  const home = [{ discordId: ids.a1 }];
  const away = [{ discordId: ids.b1 }];
  const base = { now: T0 + 20 * MIN, everyMinutes: 10, max: 2, home, away };
  const none = { status: 'none', home: [], away: [] };
  assert.equal(reminderDue({ ...base, thread: { prompts: 0, lastPromptAt: T0 + 15 * MIN }, votes: none }), null, 'not yet');
  assert.deepEqual(reminderDue({ ...base, thread: { prompts: 0, lastPromptAt: T0 }, votes: none }).userIds, [ids.a1, ids.b1]);
  const waiting = { status: 'waiting', home: [{}], away: [] };
  assert.deepEqual(reminderDue({ ...base, thread: { prompts: 1, lastPromptAt: T0 }, votes: waiting }).userIds, [ids.b1]);
  const clash = { status: 'disputed', home: [{}], away: [{}] };
  const due = reminderDue({ ...base, thread: { prompts: 1, lastPromptAt: T0 }, votes: clash });
  assert.equal(due.disputed, true);
  assert.deepEqual(due.userIds, [ids.a1, ids.b1]);
  assert.deepEqual(reminderDue({ ...base, thread: { prompts: 2, lastPromptAt: T0 }, votes: none }), { admins: true });
  assert.equal(reminderDue({ ...base, thread: { prompts: 2, lastPromptAt: T0, adminPingedAt: T0 }, votes: none }), null);
});

test('confirm: the newest vote from the other team that we have not matched', () => {
  const f = { id: 'f1', homeTeamId: 'reef', awayTeamId: 'tide' };
  const sets = [{ home: 10, away: 5 }, { home: 10, away: 5 }];
  const subs = [
    { id: 'f1__dA1', fixtureId: 'f1', teamId: 'reef', sets, updatedAt: 2 },
    { id: 'f1__dA2', fixtureId: 'f1', teamId: 'reef', sets: [{ home: 10, away: 1 }, { home: 10, away: 1 }], updatedAt: 1 },
  ];
  assert.equal(toConfirm({ fixture: f, teamId: 'tide', subs }).id, 'f1__dA1');
  assert.equal(toConfirm({ fixture: f, teamId: 'tide', subs: [...subs, { fixtureId: 'f1', teamId: 'tide', sets, updatedAt: 3 }] }).id, 'f1__dA2', 'already matched the newest one');
});

// ---------- the whole thing ----------
function world({ now = T0 + MIN } = {}) {
  const clock = { t: now, now() { return this.t; }, setInterval() { return null; }, clearInterval() {} };
  const event = { id: 'night', title: 'Exhibition Night', published: true, status: 'upcoming', date: T0, matchFormat: {} };
  const bundle = {
    event,
    fixtures: [
      { id: 'f1', homeTeamId: 'reef', awayTeamId: 'tide', order: 1, round: 1, label: 'Round 1' },
      { id: 'f2', homeTeamId: 'reef', awayTeamId: 'tide', order: 2, round: 2, label: 'Round 2' },
    ],
    results: {},
    submissions: [],
  };
  const site = {
    events: new Map([[event.id, event]]),
    teams: new Map([
      ['reef', { id: 'reef', name: 'Reef Raiders', shortName: 'REEF', status: 'approved', managerPlayerId: 'dA1' }],
      ['tide', { id: 'tide', name: 'Tasman Tide', shortName: 'TIDE', status: 'approved', managerPlayerId: 'dB1' }],
    ]),
    players: new Map([
      ['dA1', { id: 'dA1', displayName: 'Ari', discordId: ids.a1, uid: `discord:${ids.a1}`, teamId: 'reef' }],
      ['dA2', { id: 'dA2', displayName: 'Ana', discordId: ids.a2, uid: `discord:${ids.a2}`, teamId: 'reef' }],
      ['dB1', { id: 'dB1', displayName: 'Ben', discordId: ids.b1, uid: `discord:${ids.b1}`, teamId: 'tide' }],
      ['dB2', { id: 'dB2', displayName: 'Bo', discordId: ids.b2, teamId: 'tide' }], // never signed in on the site
    ]),
    bundles: () => [bundle],
    ready: () => true,
  };
  const db = new Map();
  const rest = {
    uid: 'bot-uid',
    commits: [],
    uploads: [],
    async token() { return 'token'; },
    async list() { return []; },
    async upload(bucket, path, data, type) { this.uploads.push({ bucket, path, type, size: data.length }); return path; },
    async commit(writes) {
      this.commits.push(writes);
      for (const w of writes) {
        db.set(w.path, w.data);
        // What the site's listeners would then see.
        const [, , kind, docId] = w.path.split('/');
        if (kind === 'submissions') {
          bundle.submissions = [...bundle.submissions.filter((s) => s.id !== docId), { id: docId, ...w.data, updatedAt: clock.t }];
        }
        if (kind === 'results') bundle.results[docId] = { id: docId, ...w.data };
      }
    },
  };
  const io = {
    guildId: '555555555555555555',
    channelId: '666666666666666666',
    threads: [],
    posts: [],
    edits: [],
    closed: [],
    async createThread(name) { this.threads.push(name); return `th${this.threads.length}`; },
    async post(message, threadId, files = []) { this.posts.push({ message, threadId, files }); return `m${this.posts.length}`; },
    downloads: [],
    async edit(messageId, message, threadId, files = []) { this.edits.push({ messageId, message, threadId, files }); },
    async close(threadId) { this.closed.push(threadId); },
    async reopen() {},
    async download(url) { this.downloads.push(url); return Buffer.from('png'); },
  };
  const config = {
    siteUrl: 'https://i-love-jvo.web.app', adminRoleIds: ['777777777777777777'],
    matchRemindMinutes: 10, matchRemindMax: 2, matchCloseMinutes: 15,
    firebase: { storageBucket: 'i-love-jvo.firebasestorage.app' },
  };
  const matches = new MatchThreads({ io, site, rest, config, clock, log: { info() {}, warn() {}, error() {} } });
  return { matches, io, rest, db, bundle, site, clock };
}
const user = (id) => ({ id, name: 'someone' });
// The match card in a thread as it looks now (the latest edit, or as first posted).
const lastCard = (io, threadId = 'th1') => [...io.edits].reverse().find((e) => e.threadId === threadId)?.message
  ?? io.posts.find((p) => p.threadId === threadId && p.message.embeds)?.message;

test('nothing before the event starts; then a thread per open match, pinging both squads', async () => {
  const w = world({ now: T0 - 5 * MIN });
  await w.matches.start();
  assert.equal(w.io.threads.length, 0);
  w.clock.t = T0 + MIN;
  await w.matches.sync();
  assert.equal(w.io.threads.length, 1, 'only round 1 is open (round 2 waits for it)');
  assert.match(w.io.threads[0], /REEF vs TIDE · Round 1/);
  const card = w.io.posts[0].message;
  for (const id of [ids.a1, ids.a2, ids.b1, ids.b2]) assert.ok(card.content.includes(`<@${id}>`), 'everyone is pinged');
  assert.deepEqual(card.allowedMentions.users.sort(), [ids.a1, ids.a2, ids.b1, ids.b2].sort());
  assert.match(card.embeds[0].fields[0].value, /👑 <@100000000000000001>/, 'the captain is marked');
  assert.deepEqual(card.components[0].components.map((b) => b.label), ['Report score', 'Match page']);
  const saved = w.db.get('matchThreads/night__f1');
  assert.equal(saved.status, 'open');
  assert.equal(saved.url, 'https://discord.com/channels/555555555555555555/th1');
  // Syncing again changes nothing (no new thread, no needless edit).
  await w.matches.sync();
  assert.equal(w.io.threads.length, 1);
  assert.equal(w.io.edits.length, 0);
});

test('votes in Discord: saved like the site does, then the score goes live when both teams agree', async () => {
  const w = world();
  await w.matches.start();
  const form = await w.matches.button('mt:vote:night__f1', user(ids.a2));
  assert.equal(form.modal.custom_id, 'mtm:night__f1');

  let reply = await w.matches.modal('mtm:night__f1', user(ids.a2), { sets: '10-7, 10-8', files: [{ url: 'https://cdn/x.png', name: 'x.png', contentType: 'image/png' }] });
  assert.match(reply.ephemeral, /goes live as soon as/);
  const vote = w.db.get('events/night/submissions/f1__dA2');
  assert.equal(vote.via, 'discord');
  assert.equal(vote.uid, `discord:${ids.a2}`);
  assert.equal(vote.teamId, 'reef');
  assert.equal(vote.updatedBy, 'bot-uid');
  assert.deepEqual(vote.sets, [{ home: 10, away: 7 }, { home: 10, away: 8 }]);
  assert.equal(vote.screenshotPaths.length, 1);
  assert.match(vote.screenshotPaths[0], /^players\/dA2\/shot\/.+\.png$/);
  assert.equal(w.rest.uploads[0].bucket, 'i-love-jvo.firebasestorage.app');
  const first = w.rest.commits.find((c) => c[0].path.includes('/submissions/'));
  assert.deepEqual(first[0].serverTime, ['updatedAt'], 'the server stamps the time, as the rules want');
  assert.ok(first.some((x) => x.path.startsWith('auditLog/') && x.data.by === 'bot-uid'), 'an audit entry, like every site save');
  assert.ok(w.io.posts.some((p) => /voted \*\*2–0\*\*/.test(p.message.content) && p.files.length === 1), 'shown in the thread with the screenshot');

  await w.matches.sync();
  assert.match(lastCard(w.io).embeds[0].fields[2].value, /Ana: \*\*2–0\*\*/, 'the card shows the vote');

  // Tide votes something else: disputed.
  reply = await w.matches.modal('mtm:night__f1', user(ids.b1), { sets: '10-7, 8-10, 10-8', files: [] });
  assert.match(reply.ephemeral, /doesn’t match/);
  await w.matches.sync();
  assert.match(lastCard(w.io).embeds[0].description, /scores don’t match/);

  // Tide's captain confirms Reef's score instead: the score is published in the same save.
  reply = await w.matches.button('mt:confirm:night__f1', user(ids.b1));
  assert.match(reply.ephemeral, /score is live/);
  const result = w.db.get('events/night/results/f1');
  assert.deepEqual(result.sets, [{ home: 10, away: 7 }, { home: 10, away: 8 }]);
  assert.deepEqual(result.confirmedBy, ['f1__dA2', 'f1__dB1']);
  assert.equal(result.statsStatus, 'pending');
  const resultWrite = w.rest.commits.at(-1).find((x) => x.path === 'events/night/results/f1');
  assert.equal(resultWrite.mustNotExist, true);
  assert.deepEqual(resultWrite.serverTime, ['updatedAt', 'enteredAt']);

  // The card shows the final score, then the thread closes 15 minutes later.
  await w.matches.sync();
  assert.match(lastCard(w.io).embeds[0].description, /Reef Raiders win 2–0/);
  assert.equal(lastCard(w.io).components[0].components.length, 1, 'only the match page link is left');
  assert.ok(w.io.posts.some((p) => /Final: Reef Raiders 2–0 Tasman Tide/.test(p.message.content)));
  assert.equal(w.db.get('matchThreads/night__f1').status, 'done');
  w.clock.t += 16 * MIN;
  await w.matches.sync();
  assert.deepEqual(w.io.closed, ['th1']);
  assert.equal(w.db.get('matchThreads/night__f1').status, 'closed');
  assert.equal(w.io.threads.length, 2, 'round 2 opened once round 1 had its score');
});

test('only the two teams’ players can vote; captains only can confirm; bad scores are explained', async () => {
  const w = world();
  await w.matches.start();
  assert.match((await w.matches.button('mt:vote:night__f1', user(ids.x))).ephemeral, /isn’t linked/);
  assert.match((await w.matches.button('mt:vote:night__f1', user(ids.b2))).ephemeral, /isn’t linked/, 'never signed in on the site');
  w.site.players.set('dX', { id: 'dX', discordId: ids.x, uid: 'discord:x', teamId: 'other' });
  w.site.teams.set('other', { id: 'other', name: 'Other', status: 'approved' });
  assert.match((await w.matches.button('mt:vote:night__f1', user(ids.x))).ephemeral, /Only players on/);
  assert.match((await w.matches.button('mt:confirm:night__f1', user(ids.a2))).ephemeral, /Only a team’s captain/);
  assert.match((await w.matches.modal('mtm:night__f1', user(ids.a1), { sets: '10-9, 10-2' })).ephemeral, /win by 2/);
  assert.equal(w.rest.commits.filter((c) => c.some((x) => x.path.includes('/submissions/'))).length, 0, 'nothing saved');
});

test('who’s who: unknown names from the stats reading are asked in the thread, and players claim them', async () => {
  const w = world();
  await w.matches.start();
  // The score is in, and the site's automatic reading couldn't place "AD" (17 pts).
  w.bundle.results.f1 = {
    id: 'f1', sets: [{ home: 10, away: 5 }, { home: 10, away: 5 }], statsStatus: 'pending', playerStats: {},
    statsDraft: {
      shot: 'players/dA1/shot/x.webp', readAt: 1,
      rows: [
        { name: 'Ari', playerId: 'dA1', stats: { pts: { value: 5, sure: true } } },
        { name: 'AD', playerId: null, stats: { pts: { value: 17, sure: true } } },
        { name: 'So', playerId: null, stats: { pts: { value: 0, sure: true } } }, // an empty slot: not asked
      ],
    },
  };
  await w.matches.sync();
  const ask = w.io.posts.find((p) => p.message.embeds?.[0]?.title === '❓ Who’s who?');
  assert.ok(ask, 'asked in the thread');
  assert.match(ask.message.embeds[0].description, /\*\*AD\*\*: 17 PTS/);
  assert.doesNotMatch(ask.message.embeds[0].description, /So\b/);
  assert.deepEqual(ask.message.components[0].components.map((b) => b.custom_id), ['mt:me:night__f1:1']);
  assert.ok(!ask.message.allowedMentions.users.includes(ids.a1), 'Ari was found, so not pinged');
  assert.ok(ask.message.allowedMentions.users.includes(ids.a2));
  assert.deepEqual(ask.files.map((f) => f.name), ['match-screenshot.webp'], 'the screenshot is attached');
  assert.equal(ask.message.embeds[0].image.url, 'attachment://match-screenshot.webp');
  assert.match(w.io.downloads[0], /firebasestorage\.googleapis\.com\/v0\/b\/i-love-jvo\.firebasestorage\.app\/o\/players%2FdA1%2Fshot%2Fx\.webp\?alt=media/);

  // After a restart, a question already sent is edited once, with the screenshot.
  const again = new MatchThreads({ io: w.io, site: w.site, rest: w.rest, config: w.matches.config, clock: w.clock, log: { info() {}, warn() {}, error() {} } });
  again.threads = w.matches.threads;
  const askId = w.matches.threads.get('night__f1').askMsgId;
  const askEdits = () => w.io.edits.filter((e) => e.messageId === askId);
  await again.sync();
  assert.equal(askEdits().length, 1);
  const edit = askEdits()[0];
  assert.deepEqual(edit.files.map((f) => f.name), ['match-screenshot.webp']);
  assert.equal(edit.message.embeds[0].image.url, 'attachment://match-screenshot.webp');
  await again.sync();
  assert.equal(askEdits().length, 1, 'and not again when nothing changed');

  assert.match((await w.matches.button('mt:me:night__f1:1', user(ids.x))).ephemeral, /isn’t linked/);
  assert.match((await w.matches.button('mt:me:night__f1:1', user(ids.a1))).ephemeral, /already have a line/);
  const reply = await w.matches.button('mt:me:night__f1:1', user(ids.b1));
  assert.match(reply.ephemeral, /now down as yours/);
  const write = w.rest.commits.at(-1)[0];
  assert.equal(write.path, 'events/night/results/f1');
  assert.deepEqual(write.mask, ['statsDraft', 'updatedBy']);
  assert.equal(write.data.statsDraft.rows[1].playerId, 'dB1');
  assert.equal(write.data.statsDraft.rows[1].claimedBy, ids.b1);

  // The site sees it; the question updates to "all sorted", and the thread can close.
  w.bundle.results.f1 = { ...w.bundle.results.f1, statsDraft: write.data.statsDraft };
  await w.matches.sync();
  assert.match(w.io.edits.at(-1).message.content, /all sorted/);
  w.clock.t += 16 * MIN;
  await w.matches.sync();
  assert.deepEqual(w.io.closed, ['th1']);
});

test('reminders: pinged again while there is no score, then admins once', async () => {
  const w = world();
  await w.matches.start();
  const reminders = () => w.io.posts.filter((p) => /Reminder|still has no confirmed score|Scores don’t match/.test(p.message.content ?? ''));
  w.clock.t += 5 * MIN;
  await w.matches.sync();
  assert.equal(reminders().length, 0, 'not yet');
  w.clock.t += 6 * MIN;
  await w.matches.sync();
  assert.equal(reminders().length, 1);
  assert.match(reminders()[0].message.content, /Reminder 1\/2/);
  assert.deepEqual(reminders()[0].message.allowedMentions.users.sort(), [ids.a1, ids.a2, ids.b1, ids.b2].sort());

  // Reef votes: the next reminder is only for Tide.
  await w.matches.modal('mtm:night__f1', user(ids.a1), { sets: '10-3, 10-3' });
  w.clock.t += 11 * MIN;
  await w.matches.sync();
  assert.deepEqual(reminders()[1].message.allowedMentions.users.sort(), [ids.b1, ids.b2].sort());

  w.clock.t += 11 * MIN;
  await w.matches.sync();
  assert.match(reminders()[2].message.content, /<@&777777777777777777>.*still has no confirmed score/s);
  w.clock.t += 30 * MIN;
  await w.matches.sync();
  assert.equal(reminders().length, 3, 'admins are pinged once');
});
