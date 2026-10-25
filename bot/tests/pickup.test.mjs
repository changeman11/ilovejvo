// The whole pickup flow with a pretend Discord (FakeIo) and a clock the test moves forward:
// sign up -> countdown -> random mode -> locked ready-up channel (ready check) -> captains -> draft
// -> locked team channels -> result -> Elo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pickup } from '../src/pickup.js';
import { FileStore } from '../src/store/file-store.js';
import { seeded } from '../src/logic/random.js';
import { currentSide } from '../src/logic/draft.js';
import { queueView } from '../src/views.js';

const quiet = { info() {}, warn() {}, error(...a) { throw new Error(a.join(' ')); } };

class FakeClock {
  t = 1_000_000;
  timers = [];
  n = 0;
  now() { return this.t; }
  setTimeout(fn, ms) { const id = ++this.n; this.timers.push({ id, at: this.t + ms, fn }); return id; }
  clearTimeout(id) { this.timers = this.timers.filter((x) => x.id !== id); }
  async advance(ms, pickup) {
    const end = this.t + ms;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const next = this.timers[0];
      if (!next || next.at > end) break;
      this.timers.shift();
      this.t = next.at;
      next.fn();
      await pickup.idle();
    }
    this.t = end;
    await pickup.idle();
  }
}

// Pretend Discord. The bot's own moves don't fire voice events here; tests send the events that
// players cause (joining or leaving a ready-up channel) themselves.
class FakeIo {
  messages = new Map();
  channels = new Map(); // id -> { name, allow }
  voice = new Map(); // userId -> channelId
  posted = [];
  n = 0;
  where = new Map(); // messageId -> channel it was posted in ('pickup' or a chat id)
  async post(m, channel = 'pickup') { const id = `m${++this.n}`; this.messages.set(id, m); this.where.set(id, channel); this.posted.push(id); return id; }
  async edit(id, m) { if (!this.messages.has(id)) throw new Error('Unknown Message'); this.messages.set(id, m); }
  async remove(id) { this.messages.delete(id); }
  async createVoice(name, { allow = [] } = {}) { const id = `vc${++this.n}`; this.channels.set(id, { name, allow }); return id; }
  async createText(name, { allow = [] } = {}) { const id = `tc${++this.n}`; this.channels.set(id, { name, allow, text: true }); return id; }
  async renameChannel(id, name) { this.channels.get(id).name = name; }
  async deleteChannel(id) { this.channels.delete(id); }
  async channelSize(id) { return this.channels.has(id) ? [...this.voice.values()].filter((c) => c === id).length : -1; }
  async move(userId, channelId) { if (!this.voice.has(userId)) return false; this.voice.set(userId, channelId); return true; }
}

const config = {
  modes: [2, 3, 4, 5, 6],
  draftOrder: 'alternate',
  countdownSeconds: 30,
  readySeconds: 60,
  pickSeconds: 60,
  startRating: 1000,
  k: 32,
  adminRoleIds: [],
  allowTestPlayers: true,
};

function setup({ seed = 1, store = new FileStore({ startRating: 1000 }), io = new FakeIo(), clock = new FakeClock(), cfg = config } = {}) {
  const pickup = new Pickup({ io, store, config: cfg, clock, rng: seeded(seed), log: quiet });
  return { pickup, io, store, clock };
}

// Players sign up with the menu (they don't need to be in voice).
async function joinAll(env, count, from = 1) {
  for (let i = from; i < from + count; i++) await env.pickup.join(`u${i}`, `Player ${i}`);
  await env.pickup.idle();
}

const matchIn = (env, phase) => [...env.pickup.matches.values()].find((m) => !phase || m.phase === phase);
const realIds = (match) => match.players.filter((p) => !p.fake).map((p) => p.id);

// Picked players move themselves from wherever they are into their locked ready-up channel.
async function confirm(env, ids) {
  const match = matchIn(env, 'check');
  for (const id of ids) {
    const from = env.io.voice.get(id);
    env.io.voice.set(id, match.lobbyId);
    if (from) await env.pickup.left(from, id);
    await env.pickup.joined(match.lobbyId, id);
  }
  await env.pickup.idle();
}

// Countdown ends, everyone picked joins the ready-up channel: the draft starts.
async function toDraft(env) {
  await env.clock.advance(30_000, env.pickup);
  await confirm(env, realIds(matchIn(env, 'check')));
  const match = matchIn(env, 'draft');
  assert.ok(match, 'the draft started');
  return match;
}

// Captains pick the first player in the pool until the draft is done.
async function runDraft(env) {
  const match = matchIn(env, 'draft');
  assert.ok(match, 'a draft is running');
  while (env.pickup.matches.has(match.id)) {
    const side = currentSide(match.state);
    const captain = match.state.captains[side];
    const reply = await env.pickup.button(`pick:${match.id}:${match.state.pool[0]}`, { id: captain, name: match.names[captain], isAdmin: false });
    assert.equal(reply, null);
  }
  return match;
}

test('full flow: sign up -> countdown -> locked ready check -> 2v2 draft -> locked team channels -> result -> Elo', async () => {
  const env = setup();
  await env.pickup.start();
  await joinAll(env, 4);
  assert.ok(env.pickup.countdown, 'countdown started at 4 signed up');
  await env.clock.advance(29_000, env.pickup);
  assert.equal(env.pickup.matches.size, 0, 'still counting down');
  await env.clock.advance(1_000, env.pickup);

  // Ready check: a locked channel only those four can join, and a message pinging them.
  const check = matchIn(env, 'check');
  assert.ok(check);
  const lobby = env.io.channels.get(check.lobbyId);
  assert.equal(lobby.name, '🏐 ready up · 2v2');
  assert.deepEqual([...lobby.allow].sort(), ['u1', 'u2', 'u3', 'u4']);
  // ...and a locked match chat, only those four can see, where the ready-check card pings them.
  const chat = env.io.channels.get(check.chatId);
  assert.ok(chat.text);
  assert.equal(chat.name, 'ready-up-2v2');
  assert.deepEqual([...chat.allow].sort(), ['u1', 'u2', 'u3', 'u4']);
  assert.equal(env.io.where.get(check.messageId), check.chatId, 'the card is in the match chat');
  const checkMsg = env.io.messages.get(check.messageId);
  assert.deepEqual(checkMsg.allowedMentions.users.sort(), ['u1', 'u2', 'u3', 'u4']);
  assert.match(checkMsg.content, new RegExp(`join <#${check.lobbyId}> within 60 seconds`));

  await confirm(env, ['u1', 'u2', 'u3']);
  assert.equal(check.phase, 'check', 'waiting for the 4th');
  assert.match(env.io.messages.get(check.messageId).embeds[0].title, /3\/4/);
  await confirm(env, ['u4']);
  assert.equal(check.phase, 'draft', 'everyone in: the draft starts straight away');
  // The draft happens in the match chat too: the ready-check card says everyone's in, and the
  // draft card is a new message under it (pinging the captains).
  assert.equal(env.io.where.get(check.messageId), check.chatId);
  assert.match(env.io.messages.get(check.messageId).embeds[0].title, /draft/);
  assert.match(env.io.messages.get(check.messageId).content, /draft!.*Captains/);
  const card4 = [...env.io.where].find(([, ch]) => ch === check.chatId)[0];
  assert.match(env.io.messages.get(card4).content, /Everyone's in!.*draft is below/);
  const postsBefore = env.io.posted.filter((id) => env.io.where.get(id) === 'pickup').length;

  const draftMsg = env.io.messages.get(check.messageId);
  assert.match(draftMsg.content, /2v2 draft/);
  assert.equal(draftMsg.components[0].components.length, 2, 'two players to pick from');

  const match = await runDraft(env);
  const game = env.pickup.games.get('g1');
  assert.equal(game.status, 'playing');
  assert.equal(game.teams.a.players.length, 2);

  // Two locked team channels, each open only to its own team; everyone moved in; lobby gone.
  for (const side of ['a', 'b']) {
    const channel = env.io.channels.get(game.channels[side]);
    assert.deepEqual([...channel.allow].sort(), game.teams[side].players.map((p) => p.id).sort());
    for (const p of game.teams[side].players) assert.equal(env.io.voice.get(p.id), game.channels[side]);
  }
  assert.match(env.io.channels.get(game.channels.a).name, /^🏐 #1 Team 1 · /);
  assert.ok(!env.io.channels.has(match.lobbyId), 'the ready-up channel is deleted');
  assert.equal(env.io.channels.get(game.channels.chat).name, 'game-1', 'the match chat became the game chat');
  assert.equal(env.io.channels.size, 3);

  const card = env.io.messages.get(match.messageId);
  assert.equal(env.io.where.get(match.messageId), game.channels.chat, 'the game card is in the game chat');
  assert.deepEqual(card.components[0].components.map((b) => b.custom_id), ['res:g1:a', 'res:g1:b', 'res:g1:cancel']);

  // Someone who isn't a captain can't report; both captains agree -> Elo.
  const outsider = game.teams.a.players.find((p) => p.id !== game.teams.a.captain);
  assert.match((await env.pickup.button('res:g1:b', { id: outsider.id, name: 'x', isAdmin: false })).ephemeral, /Only the two captains/);
  assert.match((await env.pickup.button('res:g1:a', { id: game.teams.a.captain, name: 'A', isAdmin: false })).ephemeral, /Waiting for the other captain/);
  assert.equal(env.store.ratings().length, 0, 'no Elo change until both agree');
  assert.equal(await env.pickup.button('res:g1:a', { id: game.teams.b.captain, name: 'B', isAdmin: false }), null);
  const done = await env.store.getGame('g1');
  assert.equal(done.status, 'done');
  for (const p of game.teams.a.players) assert.equal(env.store.rating(p.id).rating, 1016);
  for (const p of game.teams.b.players) assert.equal(env.store.rating(p.id).rating, 984);
  // #pickup gets a result summary (the chat with the game card is deleted).
  const summaries = env.io.posted.filter((id) => env.io.where.get(id) === 'pickup' && /Game #1/.test(env.io.messages.get(id)?.embeds?.[0]?.title ?? ''));
  assert.equal(summaries.length, 1);
  assert.match(env.io.messages.get(summaries[0]).embeds[0].description, /won/);
  assert.ok(env.io.posted.filter((id) => env.io.where.get(id) === 'pickup').length > postsBefore);
  assert.ok(!env.io.channels.has(game.channels.chat), 'the game chat is deleted once the result is in');

  // Team channels go once they're empty.
  for (const side of ['a', 'b']) {
    for (const p of game.teams[side].players) {
      env.io.voice.delete(p.id);
      await env.pickup.left(game.channels[side], p.id);
    }
  }
  assert.equal(env.io.channels.size, 0);
  assert.equal((await env.store.getGame('g1')).open, false);
});

test('only modes that fit: 9 queued plays 2v2 or 4v4 (3v3 would strand 3), and the first to join get in', async () => {
  const seen = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const env = setup({ seed });
    await env.pickup.start();
    await joinAll(env, 9);
    await env.clock.advance(30_000, env.pickup);
    const match = matchIn(env, 'check');
    seen.add(match.size);
    assert.ok([2, 4].includes(match.size));
    const expected = Array.from({ length: match.size * 2 }, (_, i) => `u${i + 1}`).sort();
    assert.deepEqual(match.players.map((p) => p.id).sort(), expected, 'longest-waiting players are picked');
    assert.equal(env.pickup.readyList().length, 9 - match.size * 2);
  }
  assert.deepEqual([...seen].sort(), [2, 4]);
});

test('12 queued starts a ready check at once (no countdown needed)', async () => {
  const env = setup();
  await env.pickup.start();
  await joinAll(env, 12);
  assert.equal(env.pickup.matches.size, 1);
  assert.equal(matchIn(env, 'check').phase, 'check');
});

test('a no-show is dropped and the next player in the queue takes their place', async () => {
  const env = setup();
  await env.pickup.start();
  await joinAll(env, 5);
  await env.clock.advance(30_000, env.pickup);
  const match = matchIn(env, 'check');
  assert.deepEqual(match.players.map((p) => p.id), ['u1', 'u2', 'u3', 'u4']);
  const firstLobby = match.lobbyId;
  await confirm(env, ['u1', 'u2', 'u3']);
  await env.clock.advance(60_000, env.pickup);

  // u4 is out of the game and off the sign-up list; u5 is in.
  assert.deepEqual(match.players.map((p) => p.id), ['u1', 'u2', 'u3', 'u5']);
  assert.ok(!env.pickup.queue.has('u4'));
  assert.deepEqual(match.dropped, ['Player 4']);
  // A new locked channel that lets u5 in; the confirmed players were moved there; old one gone.
  assert.notEqual(match.lobbyId, firstLobby);
  assert.ok(!env.io.channels.has(firstLobby));
  assert.deepEqual([...env.io.channels.get(match.lobbyId).allow].sort(), ['u1', 'u2', 'u3', 'u5']);
  for (const id of ['u1', 'u2', 'u3']) assert.equal(env.io.voice.get(id), match.lobbyId);
  // A new locked chat for the new line-up too, with a fresh card pinging everyone in it.
  assert.deepEqual([...env.io.channels.get(match.chatId).allow].sort(), ['u1', 'u2', 'u3', 'u5']);
  assert.equal(env.io.where.get(match.messageId), match.chatId);
  assert.deepEqual(env.io.messages.get(match.messageId).allowedMentions.users.sort(), ['u1', 'u2', 'u3', 'u5']);
  assert.equal([...env.io.channels.values()].filter((c) => c.text).length, 1, 'the old chat was deleted');
  assert.match(env.io.messages.get(match.messageId).embeds[0].description, /Dropped .*Player 4/);

  await confirm(env, ['u5']);
  assert.equal(match.phase, 'draft');
});

test("not enough players to replace a no-show: cancelled, and the others go back to the front of the queue", async () => {
  const env = setup();
  await env.pickup.start();
  await joinAll(env, 4);
  await env.clock.advance(30_000, env.pickup);
  const match = matchIn(env, 'check');
  await confirm(env, ['u1', 'u2', 'u3']);
  await env.clock.advance(60_000, env.pickup);
  assert.equal(env.pickup.matches.size, 0);
  assert.deepEqual(env.pickup.readyList().map((p) => p.id), ['u1', 'u2', 'u3'], 'still signed up, same order');
  assert.ok(!env.pickup.queue.has('u4'));
  const notice = env.io.posted.at(-2) ? env.io.messages.get([...env.io.posted].reverse().find((id) => /cancelled/.test(env.io.messages.get(id)?.content ?? ''))) : null;
  assert.match(notice.content, /ready check cancelled: Player 4 didn't join in time/);
  assert.ok(!env.io.channels.has(match.chatId), 'the match chat is deleted');
  // The old ready-up channel goes once the three leave it.
  assert.ok(env.io.channels.has(match.lobbyId));
  for (const id of ['u1', 'u2', 'u3']) {
    env.io.voice.delete(id);
    await env.pickup.left(match.lobbyId, id);
  }
  assert.ok(!env.io.channels.has(match.lobbyId), 'ready-up channel deleted');
  // Someone new joins: 4 again, a new countdown, and the three keep their places.
  await joinAll(env, 1, 9);
  await env.clock.advance(30_000, env.pickup);
  assert.deepEqual(matchIn(env, 'check').players.map((p) => p.id), ['u1', 'u2', 'u3', 'u9']);
});

test('withdrawing stops the countdown; leaving the ready-up channel un-confirms, or cancels the draft', async () => {
  const env = setup();
  await env.pickup.start();
  await joinAll(env, 4);
  assert.ok(env.pickup.countdown);
  await env.pickup.leave('u4');
  assert.equal(env.pickup.countdown, null, 'back under 4: countdown stopped');
  await joinAll(env, 1, 5);
  await env.clock.advance(30_000, env.pickup);
  const match = matchIn(env, 'check');
  await confirm(env, ['u1', 'u2']);
  env.io.voice.delete('u2');
  await env.pickup.left(match.lobbyId, 'u2');
  assert.ok(!match.confirmed.has('u2'), 'left again: not ready any more');
  await confirm(env, ['u2', 'u3', 'u5']);
  assert.equal(match.phase, 'draft');

  env.io.voice.delete('u3');
  await env.pickup.left(match.lobbyId, 'u3');
  assert.equal(env.pickup.matches.size, 0);
  assert.ok([...env.io.messages.values()].some((m) => /draft cancelled: Player 3 left/.test(m.content)), 'notice in #pickup');
  assert.ok(!env.io.channels.has(match.chatId), 'the match chat is deleted');
  assert.deepEqual(env.pickup.readyList().map((p) => p.id), ['u1', 'u2', 'u5'], 'still signed up, same order; Player 3 is out');
});

test("a captain who doesn't pick in time gets a random pick; others can't pick for them", async () => {
  const env = setup({ seed: 4 });
  await env.pickup.start();
  await joinAll(env, 6);
  await env.pickup.command('pickup', { sub: 'start', mode: 3 }, { id: 'admin', name: 'Admin', isAdmin: true });
  const check = matchIn(env, 'check');
  assert.equal(check.size, 3);
  await confirm(env, realIds(check));
  const match = matchIn(env, 'draft');
  const side = currentSide(match.state);
  const otherCaptain = match.state.captains[side === 'a' ? 'b' : 'a'];
  assert.match((await env.pickup.button(`pick:${match.id}:${match.state.pool[0]}`, { id: otherCaptain, name: 'x', isAdmin: true })).ephemeral, /pick/);
  assert.equal(match.state.turn, 0);
  await env.clock.advance(60_000, env.pickup);
  assert.equal(match.state.turn, 1, 'random pick after 60 seconds');
  assert.match(match.note, /time ran out/);
  assert.equal(await env.pickup.button(`pick:${match.id}:${match.state.pool[0]}`, { id: 'admin', name: 'Admin', isAdmin: true }), null);
  assert.match(match.note, /picked for them by Admin/);
});

test('captains disagree -> disputed and admins are told; an admin decides; a later correction re-does the Elo', async () => {
  const env = setup({ seed: 7 });
  await env.pickup.start();
  await joinAll(env, 4);
  await toDraft(env);
  await runDraft(env);
  const game = env.pickup.games.get('g1');
  const posts = env.io.posted.length;
  await env.pickup.button('res:g1:a', { id: game.teams.a.captain, name: 'A', isAdmin: false });
  const reply = await env.pickup.button('res:g1:b', { id: game.teams.b.captain, name: 'B', isAdmin: false });
  assert.match(reply.ephemeral, /admin will decide/);
  assert.equal((await env.store.getGame('g1')).status, 'disputed');
  assert.equal(env.io.posted.length, posts + 1, 'a message asks an admin to decide');

  await env.pickup.button('res:g1:b', { id: 'admin', name: 'Admin', isAdmin: true });
  const b = game.teams.b.players[0].id;
  const a = game.teams.a.players[0].id;
  assert.equal(env.store.rating(b).rating, 1016);
  assert.equal(env.store.rating(a).rating, 984);
  assert.match((await env.pickup.button('res:g1:a', { id: game.teams.a.captain, name: 'A', isAdmin: false })).ephemeral, /already decided/);

  const fixed = await env.pickup.command('pickup', { sub: 'result', game: 1, winner: 'a' }, { id: 'admin', name: 'Admin', isAdmin: true });
  assert.match(fixed.content, /Team 1 · .* won/);
  assert.equal(env.store.rating(a).rating, 1016);
  assert.equal(env.store.rating(b).rating, 984);
  assert.equal(env.store.rating(a).games, 1, 'still one game, not two');
  assert.equal(env.store.rating(b).wins, 0);

  await env.pickup.command('pickup', { sub: 'result', game: 1, winner: 'cancel' }, { id: 'admin', name: 'Admin', isAdmin: true });
  assert.equal(env.store.rating(a).rating, 1000);
  assert.equal(env.store.ratings().length, 0);
  assert.match((await env.pickup.command('pickup', { sub: 'start' }, { id: 'u1', name: 'x', isAdmin: false })).content, /Only admins/);
});

test('both captains can agree to cancel (no Elo change)', async () => {
  const env = setup({ seed: 9 });
  await env.pickup.start();
  await joinAll(env, 4);
  await toDraft(env);
  await runDraft(env);
  const game = env.pickup.games.get('g1');
  await env.pickup.button('res:g1:cancel', { id: game.teams.a.captain, name: 'A', isAdmin: false });
  await env.pickup.button('res:g1:cancel', { id: game.teams.b.captain, name: 'B', isAdmin: false });
  assert.equal((await env.store.getGame('g1')).status, 'cancelled');
  assert.equal(env.store.ratings().length, 0);
});

test('test players: they fill the queue, are always ready, pick and agree by themselves', async () => {
  const env = setup({ seed: 2 });
  await env.pickup.start();
  await env.pickup.join('me', 'Me');
  assert.match((await env.pickup.command('pickup', { sub: 'testfill', count: 3 }, { id: 'me', name: 'Me', isAdmin: true })).content, /Added 3/);
  await env.clock.advance(30_000, env.pickup);
  const check = matchIn(env, 'check');
  assert.deepEqual(env.io.channels.get(check.lobbyId).allow, ['me'], 'only real players are let in');
  assert.equal(check.confirmed.size, 3, 'test players are ready already');
  await confirm(env, ['me']);
  const match = matchIn(env, 'draft');
  for (let i = 0; i < 5 && env.pickup.matches.has(match.id); i++) {
    const side = currentSide(match.state);
    if (match.state.captains[side] === 'me') await env.pickup.button(`pick:${match.id}:${match.state.pool[0]}`, { id: 'me', name: 'Me', isAdmin: true });
    else await env.clock.advance(2_000, env.pickup);
  }
  const game = env.pickup.games.get('g1');
  const mySide = game.teams.a.players.some((p) => p.id === 'me') ? 'a' : 'b';
  assert.equal(env.io.voice.get('me'), game.channels[mySide], 'I was moved to my team channel');
  await env.pickup.button(`res:g1:${mySide}`, { id: 'me', name: 'Me', isAdmin: true });
  assert.equal((await env.store.getGame('g1')).status, 'done');
  assert.equal(env.store.rating('me').rating, 1016);
  assert.equal(env.store.ratings().length, 1, "test players don't get ratings");
});

test('after a restart, games waiting for a result can still be reported', async () => {
  const store = new FileStore({ startRating: 1000 });
  const env = setup({ seed: 3, store });
  await env.pickup.start();
  await joinAll(env, 4);
  await toDraft(env);
  await runDraft(env);
  const game = env.pickup.games.get('g1');

  const again = setup({ seed: 5, store, io: env.io });
  await again.pickup.start();
  assert.ok(again.pickup.games.has('g1'));
  await again.pickup.button('res:g1:b', { id: game.teams.a.captain, name: 'A', isAdmin: false });
  await again.pickup.button('res:g1:b', { id: game.teams.b.captain, name: 'B', isAdmin: false });
  assert.equal((await store.getGame('g1')).winner, 'b');
  await joinAll(again, 4, 10);
  await toDraft(again);
  await runDraft(again);
  assert.ok(again.pickup.games.has('g2'), 'game numbers carry on');
});

test('shutting down cancels a ready check and keeps everyone signed up', async () => {
  const env = setup();
  await env.pickup.start();
  await joinAll(env, 4);
  await env.clock.advance(30_000, env.pickup);
  const match = matchIn(env, 'check');
  await confirm(env, ['u1', 'u2']);
  await env.pickup.shutdown();
  assert.equal(env.pickup.matches.size, 0);
  assert.deepEqual(env.pickup.readyList().map((p) => p.id), ['u1', 'u2', 'u3', 'u4']);
  assert.ok([...env.io.messages.values()].some((m) => /cancelled: the bot is restarting/.test(m.content)));
  assert.ok(!env.io.channels.has(match.chatId));
});

test('/elo and /leaderboard', async () => {
  const env = setup({ seed: 11 });
  await env.pickup.start();
  assert.match((await env.pickup.command('elo', {}, { id: 'u1', name: 'Player 1', isAdmin: false })).content, /hasn't played/);
  await joinAll(env, 4);
  await toDraft(env);
  await runDraft(env);
  const game = env.pickup.games.get('g1');
  await env.pickup.button('res:g1:a', { id: game.teams.a.captain, name: 'A', isAdmin: false });
  await env.pickup.button('res:g1:a', { id: game.teams.b.captain, name: 'B', isAdmin: false });
  const winner = game.teams.a.players[0];
  const card = await env.pickup.command('elo', { player: { id: winner.id, name: winner.name } }, { id: 'u9', name: 'x', isAdmin: false });
  assert.match(card.embeds[0].title, /1016 Elo/);
  assert.match(card.embeds[0].fields[0].value, /#1 of 4/);
  const board = await env.pickup.command('leaderboard', {}, { id: 'u9', name: 'x', isAdmin: false });
  const lines = board.embeds[0].description.split('\n');
  assert.equal(lines.length, 4);
  assert.match(lines[0], /1016 · 1-0/);
  assert.match(lines[3], /984 · 0-1/);
});

test("if the bot can't post the ready check, it cancels it and doesn't retry in a loop", async () => {
  const io = new FakeIo();
  const errors = [];
  const env = setup({ io });
  env.pickup.log = { info() {}, warn() {}, error: (...a) => errors.push(a.join(' ')) };
  await env.pickup.start();
  let attempts = 0;
  io.post = async () => {
    attempts++;
    throw new Error('Missing Permissions');
  };
  await joinAll(env, 12);
  assert.ok(attempts <= 2, 'one try (plus the cancel notice), not a loop');
  assert.equal(env.pickup.matches.size, 0);
  assert.equal(env.pickup.readyList().length, 12, 'everyone still queued');
  assert.equal(io.channels.size, 0, 'the ready-up channel and chat were removed');
  assert.ok(errors.some((e) => /Missing Permissions/.test(e)));
});

test('the Sign up / Withdraw menu', async () => {
  const env = setup();
  await env.pickup.start();
  const menu = env.io.messages.get(env.pickup.queueMessageId).components[0].components[0];
  assert.equal(menu.custom_id, 'queue');
  assert.deepEqual(menu.options.map((o) => o.value), ['join', 'leave']);
  const me = { id: 'u1', name: 'Player 1', isAdmin: false };
  assert.match((await env.pickup.select('queue', 'leave', me)).ephemeral, /weren't signed up/);
  assert.match((await env.pickup.select('queue', 'join', me)).ephemeral, /Signed up. You're #1/);
  assert.match((await env.pickup.select('queue', 'join', me)).ephemeral, /already signed up/);
  await joinAll(env, 2, 2);
  const fourth = await env.pickup.select('queue', 'join', { id: 'u4', name: 'Player 4', isAdmin: false });
  assert.match(fourth.ephemeral, /#4/);
  assert.ok(env.pickup.countdown);
  assert.match((await env.pickup.select('queue', 'leave', me)).ephemeral, /Withdrawn/);
  assert.equal(env.pickup.countdown, null);
  await env.pickup.select('queue', 'join', me);
  await env.clock.advance(30_000, env.pickup);
  // Picked: can't sign up again or withdraw; the ready-up channel is the way in or out.
  assert.match((await env.pickup.select('queue', 'join', me)).ephemeral, /join your ready-up channel/);
  assert.match((await env.pickup.select('queue', 'leave', me)).ephemeral, /don't join the ready-up channel/);
});

test('the queue message is kept up to date (at most once a second)', async () => {
  const env = setup();
  await env.pickup.start();
  const id = env.pickup.queueMessageId;
  assert.match(env.io.messages.get(id).embeds[0].description, /Need \*\*4\*\* more/);
  await joinAll(env, 3);
  await env.clock.advance(1_000, env.pickup);
  assert.match(env.io.messages.get(id).embeds[0].fields[1].value, /` 3` Player 3/);
  assert.match(env.io.messages.get(id).embeds[0].description, /🟦🟦🟦⬜  \*\*3 \/ 4\*\* players/);
  await joinAll(env, 1, 4);
  await env.clock.advance(1_000, env.pickup);
  assert.match(env.io.messages.get(id).embeds[0].description, /Starting <t:\d+:R>/);
});

test('mode votes on the queue card pick the next mode; an admin-set mode overrides them', async () => {
  const env = setup({ seed: 12 });
  await env.pickup.start();
  const voter = (id) => ({ id, name: id, isAdmin: false });
  // Voting needs a sign-up.
  assert.match((await env.pickup.select('mode', '3', voter('u1'))).ephemeral, /Sign up first/);
  await joinAll(env, 7);
  assert.match((await env.pickup.select('mode', '3', voter('u1'))).ephemeral, /Voted 3v3 \(1 vote\)/);
  assert.match((await env.pickup.select('mode', '3', voter('u2'))).ephemeral, /2 votes/);
  await env.pickup.select('mode', '2', voter('u3'));
  await env.clock.advance(1_000, env.pickup);
  const card = env.io.messages.get(env.pickup.queueMessageId).embeds[0];
  assert.match(card.description, /Next up: 3v3\nPicked by votes \(2\)/);
  assert.match(card.description, /\*\*7\*\* players · 3v3 is full/);
  assert.match(card.fields[0].value, /▶️ \*\*`3v3`\*\* ✅ · 🗳️ 2/);
  await env.clock.advance(30_000, env.pickup);
  const match = matchIn(env, 'check');
  assert.equal(match.size, 3, 'two votes picked 3v3');
  assert.equal(match.why, 'votes');
  assert.match(env.io.messages.get(match.messageId).content, /3v3 found!\*\* \(voted\)/);

  // Admin sets 2v2 for the next game only: it starts as soon as 4 are waiting; votes are paused.
  const env2 = setup({ seed: 3 });
  await env2.pickup.start();
  const set = await env2.pickup.command('pickup', { sub: 'setmode', choice: '2', nextOnly: true }, { id: 'a', name: 'Admin', isAdmin: true });
  assert.match(set.content, /2v2 for the next game/);
  await joinAll(env2, 3);
  assert.match((await env2.pickup.select('mode', '3', voter('u1'))).ephemeral, /votes are paused/);
  await joinAll(env2, 1, 4);
  const m2 = matchIn(env2, 'check');
  assert.equal(m2.size, 2, 'started at once with exactly 4');
  assert.equal(m2.why, 'admin');
  assert.equal(env2.pickup.fixedMode, null, 'next game only: back to votes');
  assert.equal(env2.store.getMeta('fixedMode'), null);
  assert.match((await env2.pickup.command('pickup', { sub: 'setmode', choice: '4' }, { id: 'u1', name: 'x', isAdmin: false })).content, /Only admins/);
});

test('random teams: more than half voting on the queue card skips the draft; fewer still drafts', async () => {
  const env = setup();
  await joinAll(env, 4);
  for (const id of ['u1', 'u2', 'u3']) {
    const reply = await env.pickup.select('teams', 'random', { id, name: id });
    assert.match(reply.ephemeral, /random teams/i);
  }
  assert.match(queueView(env.pickup.snapshot(), config).embeds[0].description, /3\*\* want random teams/);
  await env.clock.advance(30_000, env.pickup);
  await confirm(env, realIds(matchIn(env, 'check')));
  assert.equal(env.pickup.matches.size, 0, 'no draft');
  const game = [...env.pickup.games.values()][0];
  assert.ok(game?.random, 'random teams game');
  assert.equal(game.teams.a.players.length, 2);
  assert.equal(game.teams.b.players.length, 2);
  assert.ok(game.teams.a.captain && game.teams.b.captain, 'each team still has a captain to report');
  assert.match(env.io.messages.get(game.messageId).embeds[0].description, /Random teams/);

  // 2 of 4 is not more than half: a normal draft.
  const env2 = setup({ seed: 2 });
  await joinAll(env2, 4);
  for (const id of ['u1', 'u2']) await env2.pickup.select('teams', 'random', { id, name: id });
  await env2.pickup.select('teams', 'draft', { id: 'u2', name: 'u2' });
  assert.ok(await toDraft(env2));
});

test('random teams: players in a draft can vote mid-draft; captains stay captains', async () => {
  const env = setup({ seed: 3 });
  await joinAll(env, 6);
  await env.pickup.select('mode', '3', { id: 'u1', name: 'u1' });
  await env.pickup.select('mode', '3', { id: 'u2', name: 'u2' });
  const match = await toDraft(env);
  const captains = { ...match.state.captains };
  const voters = match.players.map((p) => p.id);
  assert.equal((await env.pickup.button(`rnd:${match.id}`, { id: 'outsider', name: 'x' })).ephemeral, 'Only players in this draft can vote.');
  for (const id of voters.slice(0, 3)) {
    const reply = await env.pickup.button(`rnd:${match.id}`, { id, name: id });
    assert.match(reply.ephemeral, /\(\d\/4\)/);
  }
  const card = env.io.messages.get(match.messageId);
  assert.match(JSON.stringify(card.components), /Random teams \(3\/4\)/);
  assert.equal(await env.pickup.button(`rnd:${match.id}`, { id: voters[3], name: voters[3] }), null, 'the 4th vote ends the draft');
  assert.equal(env.pickup.matches.size, 0);
  const game = [...env.pickup.games.values()][0];
  assert.ok(game.random);
  assert.equal(game.teams.a.captain, captains.a);
  assert.equal(game.teams.b.captain, captains.b);
  assert.equal(game.teams.a.players.length + game.teams.b.players.length, 6);
});

test('results go to #pickup-results when it is set up, and #pickup stays quiet', async () => {
  const env = setup({ seed: 4, cfg: { ...config, pickupResultsChannelId: 'results' } });
  await joinAll(env, 4);
  await toDraft(env);
  await runDraft(env);
  const game = [...env.pickup.games.values()][0];
  const pickupPosts = env.io.posted.filter((id) => env.io.where.get(id) === 'pickup').length;
  await env.pickup.button(`res:${game.id}:a`, { id: game.teams.a.captain, name: 'A', isAdmin: false });
  await env.pickup.button(`res:${game.id}:a`, { id: game.teams.b.captain, name: 'B', isAdmin: false });
  const summaries = env.io.posted.filter((id) => /Game #1/.test(env.io.messages.get(id)?.embeds?.[0]?.title ?? ''));
  const inResults = summaries.filter((id) => env.io.where.get(id) === 'results');
  assert.equal(inResults.length, 1, 'posted in #pickup-results');
  assert.match(env.io.messages.get(inResults[0]).embeds[0].description, /won/);
  assert.equal(env.io.posted.filter((id) => env.io.where.get(id) === 'pickup').length, pickupPosts, 'nothing new in #pickup');
});

test('the queue card points to #pickup-chat when there is one', () => {
  const env = setup({ cfg: { ...config, pickupChatChannelId: '888888888888888888' } });
  assert.match(queueView(env.pickup.snapshot(), env.pickup.config).embeds[0].description, /💬 Chat with other players in <#888888888888888888>/);
  assert.doesNotMatch(queueView(env.pickup.snapshot(), config).embeds[0].description, /💬/);
});

test('two ready checks at once: each one starts its own draft when its players are all in', async () => {
  const env = setup({ seed: 7 });
  // 4 sign up and vote 2v2: it pops after the countdown.
  await joinAll(env, 4);
  for (const id of ['u1', 'u2']) await env.pickup.select('mode', '2', { id, name: id });
  await env.clock.advance(30_000, env.pickup);
  const first = matchIn(env, 'check');
  assert.ok(first, 'first check');
  // 6 more sign up while the first check runs and vote 3v3: a second check pops.
  await joinAll(env, 6, 5);
  for (const id of ['u5', 'u6']) await env.pickup.select('mode', '3', { id, name: id });
  await env.clock.advance(30_000, env.pickup);
  const checks = [...env.pickup.matches.values()].filter((m) => m.phase === 'check');
  assert.equal(checks.length, 2, 'two ready checks at once');
  const second = checks.find((m) => m.id !== first.id);
  assert.equal(second.size, 3);
  // Everyone in the second joins first, then the first.
  const enter = async (match) => {
    for (const p of match.players) {
      env.io.voice.set(p.id, match.lobbyId);
      await env.pickup.joined(match.lobbyId, p.id);
    }
    await env.pickup.idle();
  };
  await enter(second);
  assert.equal(env.pickup.matches.get(second.id)?.phase, 'draft', 'second: draft started');
  await enter(first);
  assert.equal(env.pickup.matches.get(first.id)?.phase, 'draft', 'first: draft started');
});

test('a join Discord never reported still counts: the bot looks in the channel (sweep and time-up)', async () => {
  const io = new FakeIo();
  io.membersIn = async (channelId) => [...io.voice.entries()].filter(([, c]) => c === channelId).map(([u]) => u);
  const env = setup({ seed: 8, io });
  await joinAll(env, 4);
  for (const id of ['u1', 'u2']) await env.pickup.select('mode', '2', { id, name: id });
  await env.clock.advance(30_000, env.pickup);
  const match = matchIn(env, 'check');
  // Everyone sits in the channel but no voice events arrive.
  for (const p of match.players) io.voice.set(p.id, match.lobbyId);
  await env.clock.advance(5_000, env.pickup);
  assert.equal(env.pickup.matches.get(match.id)?.phase, 'draft', 'the 5-second look starts the draft');

  // Same at time-up, with the sweep not getting there first.
  const io2 = new FakeIo();
  const env2 = setup({ seed: 9, io: io2 });
  await joinAll(env2, 4);
  for (const id of ['u1', 'u2']) await env2.pickup.select('mode', '2', { id, name: id });
  await env2.clock.advance(30_000, env2.pickup);
  const m2 = matchIn(env2, 'check');
  io2.membersIn = async (channelId) => [...io2.voice.entries()].filter(([, c]) => c === channelId).map(([u]) => u);
  for (const p of m2.players) io2.voice.set(p.id, m2.lobbyId);
  await env2.clock.advance(60_000, env2.pickup);
  assert.equal(env2.pickup.matches.get(m2.id)?.phase, 'draft', 'time-up looks in the channel before dropping anyone');
});

test('two ready checks of the same mode get numbered channels', async () => {
  const env = setup({ seed: 10 });
  await joinAll(env, 4);
  await env.pickup.command('pickup', { sub: 'start', mode: 2 }, { id: 'admin', name: 'A', isAdmin: true });
  await env.pickup.idle();
  await joinAll(env, 4, 5);
  await env.pickup.command('pickup', { sub: 'start', mode: 2 }, { id: 'admin', name: 'A', isAdmin: true });
  await env.pickup.idle();
  const names = [...env.io.channels.values()].filter((c) => !c.text).map((c) => c.name).sort();
  assert.deepEqual(names, ['🏐 ready up · 2v2', '🏐 ready up · 2v2 #2']);
  const chats = [...env.io.channels.values()].filter((c) => c.text).map((c) => c.name).sort();
  assert.deepEqual(chats, ['ready-up-2v2', 'ready-up-2v2-2']);
});

test('admin panel: cancel a ready check (everyone back in the queue), remove someone from the queue', async () => {
  const env = setup({ seed: 11 });
  const admin = { id: 'site', name: 'Admin', isAdmin: true };
  await joinAll(env, 5);
  for (const id of ['u1', 'u2']) await env.pickup.select('mode', '2', { id, name: id });
  await env.clock.advance(30_000, env.pickup);
  const match = matchIn(env, 'check');
  assert.equal(env.pickup.liveState().matches[0].id, match.id, 'the site sees the match id');
  const busyOne = match.players[0].id;
  assert.match((await env.pickup.run(() => env.pickup.adminCommand('remove', { player: busyOne }, admin))).content, /cancel that first/);
  const r = await env.pickup.run(() => env.pickup.adminCommand('cancelmatch', { match: match.id }, admin));
  assert.match(r.content, /Cancelled the 2v2 ready check/);
  assert.equal(env.pickup.matches.size, 0);
  assert.equal(env.pickup.readyList().length >= 4, true, 'everyone back in the queue');
  assert.match((await env.pickup.run(() => env.pickup.adminCommand('cancelmatch', { match: match.id }, admin))).content, /already over/);
  const r2 = await env.pickup.run(() => env.pickup.adminCommand('remove', { player: 'u5' }, admin));
  assert.match(r2.content, /Took Player 5 off/);
  assert.equal(env.pickup.queue.has('u5'), false);
});

test('a ready check short of players with nobody to replace them plays a smaller mode instead of cancelling', async () => {
  const env = setup({ seed: 12 });
  await joinAll(env, 8);
  for (const id of ['u1', 'u2']) await env.pickup.select('mode', '4', { id, name: id });
  await env.clock.advance(30_000, env.pickup);
  const match = matchIn(env, 'check');
  assert.equal(match.size, 4);
  // 5 of 8 turn up; nobody else is signed up.
  const came = match.players.slice(0, 5).map((p) => p.id);
  for (const id of came) { env.io.voice.set(id, match.lobbyId); await env.pickup.joined(match.lobbyId, id); }
  await env.pickup.idle();
  await env.clock.advance(60_000, env.pickup);
  const now = env.pickup.matches.get(match.id);
  assert.equal(now?.phase, 'draft', 'a draft, not a cancel');
  assert.equal(now.size, 2);
  assert.deepEqual(now.players.map((p) => p.id).sort(), came.slice(0, 4).sort(), 'the longest-waiting 4 who came');
  assert.ok(env.pickup.queue.has(came[4]) && !env.pickup.busy.has(came[4]), 'the 5th goes back to the queue');
  for (const p of match.players.filter((x) => !came.includes(x.id))) assert.ok(!env.pickup.queue.has(p.id), 'no-shows are dropped');
  assert.deepEqual([...env.io.channels.values()].filter((c) => !c.text).map((c) => c.name), ['🏐 ready up · 2v2'], 'channel renamed');
  assert.ok([...env.io.messages.values()].some((m) => /instead of a 4v4/.test(m.content ?? '')));

  // Only 3 of 4 come to a 2v2 (smallest mode): nothing smaller, so it's cancelled as before.
  const env2 = setup({ seed: 13 });
  await joinAll(env2, 4);
  await env2.clock.advance(30_000, env2.pickup);
  const m2 = matchIn(env2, 'check');
  for (const p of m2.players.slice(0, 3)) { env2.io.voice.set(p.id, m2.lobbyId); await env2.pickup.joined(m2.lobbyId, p.id); }
  await env2.clock.advance(60_000, env2.pickup);
  assert.equal(env2.pickup.matches.size, 0, 'cancelled');
  assert.equal(env2.pickup.readyList().length, 3, 'the 3 who came keep their places');
});
