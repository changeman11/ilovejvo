// The whole pickup flow with a pretend Discord (FakeIo) and a clock the test moves forward:
// queue -> countdown -> random mode -> locked ready-up channel (ready check) -> captains -> draft
// -> locked team channels -> result -> Elo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pickup } from '../src/pickup.js';
import { FileStore } from '../src/store/file-store.js';
import { seeded } from '../src/logic/random.js';
import { currentSide } from '../src/logic/draft.js';

const QUEUE = 'queue-vc';
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
// players cause (joining the queue, joining or leaving a ready-up channel) themselves.
class FakeIo {
  messages = new Map();
  channels = new Map(); // id -> { name, allow }
  voice = new Map(); // userId -> channelId
  posted = [];
  n = 0;
  async post(m) { const id = `m${++this.n}`; this.messages.set(id, m); this.posted.push(id); return id; }
  async edit(id, m) { if (!this.messages.has(id)) throw new Error('Unknown Message'); this.messages.set(id, m); }
  async remove(id) { this.messages.delete(id); }
  async createVoice(name, { allow = [] } = {}) { const id = `vc${++this.n}`; this.channels.set(id, { name, allow }); return id; }
  async deleteChannel(id) { this.channels.delete(id); }
  async channelSize(id) { return this.channels.has(id) ? [...this.voice.values()].filter((c) => c === id).length : -1; }
  async move(userId, channelId) { if (!this.voice.has(userId)) return false; this.voice.set(userId, channelId); return true; }
  async where(userId) { return this.voice.get(userId) ?? null; }
  async disconnect(userId) { this.voice.delete(userId); }
}

const config = {
  modes: [2, 3, 4, 5, 6],
  draftOrder: 'alternate',
  countdownSeconds: 30,
  readySeconds: 60,
  pickSeconds: 60,
  startRating: 1000,
  k: 32,
  queueChannelId: QUEUE,
  adminRoleIds: [],
  allowTestPlayers: true,
};

function setup({ seed = 1, store = new FileStore({ startRating: 1000 }), io = new FakeIo(), clock = new FakeClock(), cfg = config } = {}) {
  const pickup = new Pickup({ io, store, config: cfg, clock, rng: seeded(seed), log: quiet });
  return { pickup, io, store, clock };
}

async function joinAll(env, count, from = 1) {
  for (let i = from; i < from + count; i++) {
    env.io.voice.set(`u${i}`, QUEUE);
    await env.pickup.join(`u${i}`, `Player ${i}`);
  }
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
    await env.pickup.joined(match.lobbyId, id, id);
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

test('full flow: queue -> countdown -> locked ready check -> 2v2 draft -> locked team channels -> result -> Elo', async () => {
  const env = setup();
  await env.pickup.start();
  await joinAll(env, 4);
  assert.ok(env.pickup.countdown, 'countdown started at 4 queued');
  await env.clock.advance(29_000, env.pickup);
  assert.equal(env.pickup.matches.size, 0, 'still counting down');
  await env.clock.advance(1_000, env.pickup);

  // Ready check: a locked channel only those four can join, and a message pinging them.
  const check = matchIn(env, 'check');
  assert.ok(check);
  const lobby = env.io.channels.get(check.lobbyId);
  assert.equal(lobby.name, '🏐 ready up · 2v2');
  assert.deepEqual([...lobby.allow].sort(), ['u1', 'u2', 'u3', 'u4']);
  const checkMsg = env.io.messages.get(check.messageId);
  assert.deepEqual(checkMsg.allowedMentions.users.sort(), ['u1', 'u2', 'u3', 'u4']);
  assert.match(checkMsg.content, new RegExp(`join <#${check.lobbyId}> within 60 seconds`));

  await confirm(env, ['u1', 'u2', 'u3']);
  assert.equal(check.phase, 'check', 'waiting for the 4th');
  assert.match(env.io.messages.get(check.messageId).embeds[0].title, /3\/4/);
  await confirm(env, ['u4']);
  assert.equal(check.phase, 'draft', 'everyone in: the draft starts straight away');
  assert.equal(env.io.messages.has(check.messageId) && env.io.messages.get(check.messageId).embeds[0].title.includes('draft'), true);

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
  assert.equal(env.io.channels.size, 2);

  const card = env.io.messages.get(match.messageId);
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

test('only modes that fit: 9 queued plays 2v2, 3v3 or 4v4, and the first to join get in', async () => {
  const seen = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const env = setup({ seed });
    await env.pickup.start();
    await joinAll(env, 9);
    await env.clock.advance(30_000, env.pickup);
    const match = matchIn(env, 'check');
    seen.add(match.size);
    assert.ok([2, 3, 4].includes(match.size));
    const expected = Array.from({ length: match.size * 2 }, (_, i) => `u${i + 1}`).sort();
    assert.deepEqual(match.players.map((p) => p.id).sort(), expected, 'longest-waiting players are picked');
    assert.equal(env.pickup.readyList().length, 9 - match.size * 2);
  }
  assert.deepEqual([...seen].sort(), [2, 3, 4]);
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

  // u4 is out of the game, the queue and the queue channel; u5 is in.
  assert.deepEqual(match.players.map((p) => p.id), ['u1', 'u2', 'u3', 'u5']);
  assert.ok(!env.pickup.queue.has('u4'));
  assert.equal(env.io.voice.get('u4'), undefined, 'u4 was taken out of the queue channel');
  assert.deepEqual(match.dropped, ['Player 4']);
  // A new locked channel that lets u5 in; the confirmed players were moved there; old one gone.
  assert.notEqual(match.lobbyId, firstLobby);
  assert.ok(!env.io.channels.has(firstLobby));
  assert.deepEqual([...env.io.channels.get(match.lobbyId).allow].sort(), ['u1', 'u2', 'u3', 'u5']);
  for (const id of ['u1', 'u2', 'u3']) assert.equal(env.io.voice.get(id), match.lobbyId);
  const ping = env.io.messages.get(env.io.posted.at(-1));
  assert.deepEqual(ping.allowedMentions.users, ['u5']);
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
  for (const id of ['u1', 'u2', 'u3']) assert.equal(env.io.voice.get(id), QUEUE, `${id} moved back to the queue channel`);
  assert.deepEqual(env.pickup.readyList().map((p) => p.id), ['u1', 'u2', 'u3'], 'same order as before');
  assert.ok(!env.pickup.queue.has('u4'));
  assert.ok(!env.io.channels.has(match.lobbyId), 'ready-up channel deleted');
  assert.match(env.io.messages.get(match.messageId).content, /ready check cancelled: Player 4 didn't join in time/);
  // Someone new joins: 4 again, a new countdown, and the three keep their places.
  await joinAll(env, 1, 9);
  await env.clock.advance(30_000, env.pickup);
  assert.deepEqual(matchIn(env, 'check').players.map((p) => p.id), ['u1', 'u2', 'u3', 'u9']);
});

test('leaving the ready-up channel: un-confirms during the check, cancels during the draft', async () => {
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
  env.io.voice.set('u2', QUEUE);
  await env.pickup.left(match.lobbyId, 'u2');
  assert.ok(!match.confirmed.has('u2'), 'left again: not ready any more');
  await confirm(env, ['u2', 'u3', 'u5']);
  assert.equal(match.phase, 'draft');

  env.io.voice.delete('u3');
  await env.pickup.left(match.lobbyId, 'u3');
  assert.equal(env.pickup.matches.size, 0);
  assert.match(env.io.messages.get(match.messageId).content, /draft cancelled: Player 3 left/);
  for (const id of ['u1', 'u2', 'u5']) assert.equal(env.io.voice.get(id), QUEUE);
  assert.deepEqual(env.pickup.readyList().map((p) => p.id), ['u1', 'u2', 'u5'], 'same order as before');
  assert.ok(!env.io.channels.has(match.lobbyId));
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
  env.io.voice.set('me', QUEUE);
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

test('shutting down sends players in a ready check back to the queue', async () => {
  const env = setup();
  await env.pickup.start();
  await joinAll(env, 4);
  await env.clock.advance(30_000, env.pickup);
  const match = matchIn(env, 'check');
  await confirm(env, ['u1', 'u2']);
  await env.pickup.shutdown();
  assert.equal(env.pickup.matches.size, 0);
  for (const id of ['u1', 'u2', 'u3', 'u4']) assert.equal(env.io.voice.get(id), QUEUE);
  assert.ok(!env.io.channels.has(match.lobbyId));
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
  assert.equal(attempts, 1, 'one try, not a loop');
  assert.equal(env.pickup.matches.size, 0);
  assert.equal(env.pickup.readyList().length, 12, 'everyone still queued');
  assert.equal(io.channels.size, 0, 'the ready-up channel was removed');
  assert.ok(errors.some((e) => /Missing Permissions/.test(e)));
});

test('the queue message is kept up to date (at most once a second)', async () => {
  const env = setup();
  await env.pickup.start();
  const id = env.pickup.queueMessageId;
  assert.match(env.io.messages.get(id).embeds[0].description, /Need \*\*4\*\* more/);
  await joinAll(env, 3);
  await env.clock.advance(1_000, env.pickup);
  assert.match(env.io.messages.get(id).embeds[0].fields[0].value, /3\. Player 3/);
  await joinAll(env, 1, 4);
  await env.clock.advance(1_000, env.pickup);
  assert.match(env.io.messages.get(id).embeds[0].description, /Starting <t:\d+:R>/);
});
