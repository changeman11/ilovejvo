// The whole pickup flow with a pretend Discord (FakeIo) and a clock the test moves forward:
// ready up -> countdown -> random mode -> captains -> draft -> team channels -> result -> Elo.
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

class FakeIo {
  messages = new Map();
  channels = new Map();
  voice = new Map(); // userId -> channelId
  posted = [];
  n = 0;
  async post(m) { const id = `m${++this.n}`; this.messages.set(id, m); this.posted.push(id); return id; }
  async edit(id, m) { if (!this.messages.has(id)) throw new Error('Unknown Message'); this.messages.set(id, m); }
  async remove(id) { this.messages.delete(id); }
  async createVoice(name) { const id = `vc${++this.n}`; this.channels.set(id, name); return id; }
  async deleteChannel(id) { this.channels.delete(id); }
  async channelSize(id) { return this.channels.has(id) ? [...this.voice.values()].filter((c) => c === id).length : -1; }
  async move(userId, channelId) { if (!this.voice.has(userId)) return false; this.voice.set(userId, channelId); return true; }
  // The draft message that has pick buttons right now.
  draftMessage() {
    for (const [id, m] of this.messages) if (m.components?.some((r) => r.components.some((b) => b.custom_id.startsWith('pick:')))) return { id, m };
    return null;
  }
  gameMessage(gameId) {
    for (const [id, m] of this.messages) if (m.embeds?.[0]?.title?.startsWith(`Game #${gameId.slice(1)} `)) return { id, m };
    return null;
  }
}

const config = {
  modes: [2, 3, 4, 5, 6],
  draftOrder: 'alternate',
  countdownSeconds: 30,
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

// Captains pick the first player in the pool until the draft is done.
async function runDraft(env) {
  const draft = [...env.pickup.drafts.values()][0];
  assert.ok(draft, 'a draft is running');
  while (env.pickup.drafts.has(draft.id)) {
    const side = currentSide(draft.state);
    const captain = draft.state.captains[side];
    const reply = await env.pickup.button(`pick:${draft.id}:${draft.state.pool[0]}`, { id: captain, name: draft.names[captain], isAdmin: false });
    assert.equal(reply, null);
  }
  return draft;
}

test('full flow: 4 ready -> 30s countdown -> 2v2 draft -> team channels -> both captains agree -> Elo', async () => {
  const env = setup();
  await env.pickup.start();
  await joinAll(env, 4);
  assert.ok(env.pickup.countdown, 'countdown started at 4 ready');
  assert.equal(env.pickup.drafts.size, 0);

  await env.clock.advance(29_000, env.pickup);
  assert.equal(env.pickup.drafts.size, 0, 'still counting down');
  await env.clock.advance(1_000, env.pickup);
  assert.equal(env.pickup.drafts.size, 1, 'draft started when the countdown ended');

  const { m: draftMsg } = env.io.draftMessage();
  assert.match(draftMsg.content, /2v2 draft/);
  assert.equal(draftMsg.components[0].components.length, 2, 'two players to pick from');

  const draft = await runDraft(env);
  assert.equal(env.pickup.drafts.size, 0);
  const game = env.pickup.games.get('g1');
  assert.equal(game.status, 'playing');
  assert.equal(game.size, 2);
  assert.equal(game.teams.a.players.length, 2);
  assert.equal(game.teams.b.players.length, 2);

  // Two team channels, everyone moved into their own team's channel.
  assert.equal(env.io.channels.size, 2);
  for (const side of ['a', 'b']) for (const p of game.teams[side].players) assert.equal(env.io.voice.get(p.id), game.channels[side]);
  assert.match(env.io.channels.get(game.channels.a), /^🏐 #1 Team 1 · /);

  // The draft message became the game card with result buttons.
  const card = env.io.messages.get(draft.messageId);
  assert.deepEqual(card.components[0].components.map((b) => b.custom_id), ['res:g1:a', 'res:g1:b', 'res:g1:cancel']);
  assert.equal((await env.store.getGame('g1')).status, 'playing', 'game saved');

  // Someone who isn't a captain can't report.
  const outsider = game.teams.a.players.find((p) => p.id !== game.teams.a.captain);
  assert.match((await env.pickup.button('res:g1:b', { id: outsider.id, name: 'x', isAdmin: false })).ephemeral, /Only the two captains/);

  const first = await env.pickup.button('res:g1:a', { id: game.teams.a.captain, name: 'A', isAdmin: false });
  assert.match(first.ephemeral, /Waiting for the other captain/);
  assert.equal(env.store.ratings().length, 0, 'no Elo change until both agree');
  assert.equal(await env.pickup.button('res:g1:a', { id: game.teams.b.captain, name: 'B', isAdmin: false }), null);

  const done = await env.store.getGame('g1');
  assert.equal(done.status, 'done');
  assert.equal(done.winner, 'a');
  for (const p of game.teams.a.players) assert.equal(env.store.rating(p.id).rating, 1016);
  for (const p of game.teams.b.players) assert.equal(env.store.rating(p.id).rating, 984);
  assert.equal(env.store.ratings()[0].wins, 1);
  assert.equal(done.changes[game.teams.a.captain].after, 1016);
  assert.match(env.io.messages.get(draft.messageId).embeds[0].description, /won/);
  assert.equal(env.io.messages.get(draft.messageId).components.length, 0, 'no buttons once decided');

  // Players are still in the team channels; they're removed once empty.
  assert.equal(env.io.channels.size, 2);
  for (const p of [...game.teams.a.players, ...game.teams.b.players]) env.io.voice.delete(p.id);
  await env.pickup.channelLeft(game.channels.a);
  await env.pickup.channelLeft(game.channels.b);
  assert.equal(env.io.channels.size, 0);
  assert.equal((await env.store.getGame('g1')).open, false);
  assert.equal(env.pickup.games.size, 0);
});

test('only modes that fit: 9 ready plays 2v2, 3v3 or 4v4, and the first to join get in', async () => {
  const seen = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const env = setup({ seed });
    await env.pickup.start();
    await joinAll(env, 9);
    await env.clock.advance(30_000, env.pickup);
    const draft = [...env.pickup.drafts.values()][0];
    const size = draft.state.size;
    seen.add(size);
    assert.ok([2, 3, 4].includes(size));
    const expected = Array.from({ length: size * 2 }, (_, i) => `u${i + 1}`).sort();
    assert.deepEqual([...draft.state.players].sort(), expected, 'longest-waiting players are picked');
    // The rest stay in the queue (and start their own countdown if there are enough).
    assert.equal(env.pickup.readyList().length, 9 - size * 2);
  }
  assert.deepEqual([...seen].sort(), [2, 3, 4]);
});

test('12 ready starts at once (no countdown needed)', async () => {
  const env = setup();
  await env.pickup.start();
  await joinAll(env, 12);
  assert.equal(env.pickup.drafts.size, 1);
});

test('countdown stops if people leave, and leaving mid-draft cancels it and returns everyone to the queue', async () => {
  const env = setup();
  await env.pickup.start();
  await joinAll(env, 4);
  assert.ok(env.pickup.countdown);
  await env.pickup.leave('u4');
  assert.equal(env.pickup.countdown, null, 'back under 4: countdown stopped');
  await joinAll(env, 1, 5);
  await env.clock.advance(30_000, env.pickup);
  assert.equal(env.pickup.drafts.size, 1);
  const draft = [...env.pickup.drafts.values()][0];
  await env.pickup.leave('u2');
  assert.equal(env.pickup.drafts.size, 0);
  assert.match(env.io.messages.get(draft.messageId).content, /cancelled: Player 2 left/);
  assert.deepEqual(env.pickup.readyList().map((p) => p.id), ['u1', 'u3', 'u5'], 'same order as before');
});

test("a captain who doesn't pick in time gets a random pick; others can't pick for them", async () => {
  const env = setup({ seed: 4 });
  await env.pickup.start();
  await joinAll(env, 6);
  await env.pickup.command('pickup', { sub: 'start', mode: 3 }, { id: 'admin', name: 'Admin', isAdmin: true });
  const draft = [...env.pickup.drafts.values()][0];
  assert.equal(draft.state.size, 3);
  const side = currentSide(draft.state);
  const otherCaptain = draft.state.captains[side === 'a' ? 'b' : 'a'];
  const reply = await env.pickup.button(`pick:${draft.id}:${draft.state.pool[0]}`, { id: otherCaptain, name: 'x', isAdmin: true });
  assert.match(reply.ephemeral, /pick/);
  assert.equal(draft.state.turn, 0);
  await env.clock.advance(60_000, env.pickup);
  assert.equal(draft.state.turn, 1, 'random pick after 60 seconds');
  assert.equal(draft.state.teams[side].length, 2);
  assert.match(draft.note, /time ran out/);
  // An admin who isn't in the draft can pick for the captain.
  const next = draft.state.captains[currentSide(draft.state)];
  assert.equal(await env.pickup.button(`pick:${draft.id}:${draft.state.pool[0]}`, { id: 'admin', name: 'Admin', isAdmin: true }), null);
  assert.match(draft.note, /picked for them by Admin/);
  assert.notEqual(next, undefined);
});

test('captains disagree -> disputed and admins are told; an admin decides; a later correction re-does the Elo', async () => {
  const env = setup({ seed: 7 });
  await env.pickup.start();
  await joinAll(env, 4);
  await env.clock.advance(30_000, env.pickup);
  await runDraft(env);
  const game = env.pickup.games.get('g1');
  const posts = env.io.posted.length;
  await env.pickup.button('res:g1:a', { id: game.teams.a.captain, name: 'A', isAdmin: false });
  const reply = await env.pickup.button('res:g1:b', { id: game.teams.b.captain, name: 'B', isAdmin: false });
  assert.match(reply.ephemeral, /admin will decide/);
  assert.equal((await env.store.getGame('g1')).status, 'disputed');
  assert.equal(env.io.posted.length, posts + 1, 'a message asks an admin to decide');

  // Admin decides with a button: team 2 won.
  await env.pickup.button('res:g1:b', { id: 'admin', name: 'Admin', isAdmin: true });
  const b = game.teams.b.players[0].id;
  const a = game.teams.a.players[0].id;
  assert.equal(env.store.rating(b).rating, 1016);
  assert.equal(env.store.rating(a).rating, 984);
  assert.equal((await env.store.getGame('g1')).decidedBy.by, 'admin');
  // Buttons on a decided game just explain.
  assert.match((await env.pickup.button('res:g1:a', { id: game.teams.a.captain, name: 'A', isAdmin: false })).ephemeral, /already decided/);

  // Correction: actually team 1 won. Old change undone, new one applied.
  const fixed = await env.pickup.command('pickup', { sub: 'result', game: 1, winner: 'a' }, { id: 'admin', name: 'Admin', isAdmin: true });
  assert.match(fixed.content, /Team 1 · .* won/);
  assert.equal(env.store.rating(a).rating, 1016);
  assert.equal(env.store.rating(b).rating, 984);
  assert.equal(env.store.rating(a).games, 1, 'still one game, not two');
  assert.equal(env.store.rating(a).wins, 1);
  assert.equal(env.store.rating(b).losses, 1);
  assert.equal(env.store.rating(b).wins, 0);

  // And cancelled: everyone back to where they started.
  await env.pickup.command('pickup', { sub: 'result', game: 1, winner: 'cancel' }, { id: 'admin', name: 'Admin', isAdmin: true });
  assert.equal(env.store.rating(a).rating, 1000);
  assert.equal(env.store.rating(a).games, 0);
  assert.equal(env.store.ratings().length, 0);
  // Non-admins can't use /pickup.
  assert.match((await env.pickup.command('pickup', { sub: 'start' }, { id: 'u1', name: 'x', isAdmin: false })).content, /Only admins/);
});

test('both captains can agree to cancel (no Elo change)', async () => {
  const env = setup({ seed: 9 });
  await env.pickup.start();
  await joinAll(env, 4);
  await env.clock.advance(30_000, env.pickup);
  await runDraft(env);
  const game = env.pickup.games.get('g1');
  await env.pickup.button('res:g1:cancel', { id: game.teams.a.captain, name: 'A', isAdmin: false });
  await env.pickup.button('res:g1:cancel', { id: game.teams.b.captain, name: 'B', isAdmin: false });
  assert.equal((await env.store.getGame('g1')).status, 'cancelled');
  assert.equal(env.store.ratings().length, 0);
});

test('test players: /pickup testfill fills the queue, pretend captains pick and agree by themselves', async () => {
  const env = setup({ seed: 2 });
  await env.pickup.start();
  env.io.voice.set('me', QUEUE);
  await env.pickup.join('me', 'Me');
  const added = await env.pickup.command('pickup', { sub: 'testfill', count: 3 }, { id: 'me', name: 'Me', isAdmin: true });
  assert.match(added.content, /Added 3/);
  await env.clock.advance(30_000, env.pickup);
  const draft = [...env.pickup.drafts.values()][0];
  assert.ok(draft);
  // Let pretend captains pick; if it's my turn, I pick.
  for (let i = 0; i < 5 && env.pickup.drafts.has(draft.id); i++) {
    const side = currentSide(draft.state);
    if (draft.state.captains[side] === 'me') await env.pickup.button(`pick:${draft.id}:${draft.state.pool[0]}`, { id: 'me', name: 'Me', isAdmin: true });
    else await env.clock.advance(2_000, env.pickup);
  }
  const game = env.pickup.games.get('g1');
  assert.ok(game, 'the game started');
  const mySide = game.teams.a.players.some((p) => p.id === 'me') ? 'a' : 'b';
  assert.equal(env.io.voice.get('me'), game.channels[mySide], 'I was moved to my team channel');
  const iAmCaptain = game.teams[mySide].captain === 'me';
  // As captain, the pretend captain agrees with me; otherwise I decide as an admin.
  await env.pickup.button(`res:g1:${mySide}`, { id: 'me', name: 'Me', isAdmin: true });
  assert.equal((await env.store.getGame('g1')).status, 'done', iAmCaptain ? 'captain + pretend captain' : 'admin');
  assert.equal(env.store.rating('me').rating, 1016);
  assert.equal(env.store.ratings().length, 1, "pretend players don't get ratings");
});

test('after a restart, games waiting for a result can still be reported', async () => {
  const store = new FileStore({ startRating: 1000 });
  const env = setup({ seed: 3, store });
  await env.pickup.start();
  await joinAll(env, 4);
  await env.clock.advance(30_000, env.pickup);
  await runDraft(env);
  const game = env.pickup.games.get('g1');

  // A new bot process with the same saved data.
  const again = setup({ seed: 5, store, io: env.io });
  await again.pickup.start();
  assert.ok(again.pickup.games.has('g1'));
  await again.pickup.button('res:g1:b', { id: game.teams.a.captain, name: 'A', isAdmin: false });
  await again.pickup.button('res:g1:b', { id: game.teams.b.captain, name: 'B', isAdmin: false });
  assert.equal((await store.getGame('g1')).winner, 'b');
  // Game numbers carry on.
  await joinAll(again, 4, 10);
  await again.clock.advance(30_000, again.pickup);
  await runDraft(again);
  assert.ok(again.pickup.games.has('g2'));
});

test('/elo and /leaderboard', async () => {
  const env = setup({ seed: 11 });
  await env.pickup.start();
  const none = await env.pickup.command('elo', {}, { id: 'u1', name: 'Player 1', isAdmin: false });
  assert.match(none.content, /hasn't played/);
  await joinAll(env, 4);
  await env.clock.advance(30_000, env.pickup);
  await runDraft(env);
  const game = env.pickup.games.get('g1');
  await env.pickup.button('res:g1:a', { id: game.teams.a.captain, name: 'A', isAdmin: false });
  await env.pickup.button('res:g1:a', { id: game.teams.b.captain, name: 'B', isAdmin: false });
  const winner = game.teams.a.players[0];
  const card = await env.pickup.command('elo', { player: { id: winner.id, name: winner.name } }, { id: 'u9', name: 'x', isAdmin: false });
  assert.match(card.embeds[0].title, /1016 Elo/);
  assert.match(card.embeds[0].fields[0].value, /#1 of 4/);
  const board = await env.pickup.command('leaderboard', {}, { id: 'u9', name: 'x', isAdmin: false });
  assert.equal(board.embeds[0].description.split('\n').length, 4);
  assert.match(board.embeds[0].description.split('\n')[0], /1016 · 1-0/);
  assert.match(board.embeds[0].description.split('\n')[3], /984 · 0-1/);
});

test("if the bot can't post the draft, it cancels it and doesn't retry in a loop", async () => {
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
  assert.equal(env.pickup.drafts.size, 0);
  assert.equal(env.pickup.readyList().length, 12, 'everyone still queued');
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
