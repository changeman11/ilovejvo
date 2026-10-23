// The 1v1 ranked queue with a pretend Discord and a clock the test moves forward.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ranked } from '../src/ranked.js';
import { FileStore } from '../src/store/file-store.js';

const QUEUE = 'queue-ch';
const RESULTS = 'results-ch';

class FakeClock {
  t = 1_000_000; timers = []; n = 0;
  now() { return this.t; }
  setTimeout(fn, ms) { const id = ++this.n; this.timers.push({ id, at: this.t + ms, fn }); return id; }
  clearTimeout(id) { this.timers = this.timers.filter((x) => x.id !== id); }
  async advance(ms, r) {
    const end = this.t + ms;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const next = this.timers[0];
      if (!next || next.at > end) break;
      this.timers.shift();
      this.t = next.at;
      next.fn();
      await r.idle();
    }
    this.t = end;
    await r.idle();
  }
}

class FakeIo {
  messages = new Map(); where_ = new Map(); channels = new Map(); voice = new Map(); files = new Map(); n = 0;
  async post(m, ch, files = []) { const id = `m${++this.n}`; this.messages.set(id, m); this.where_.set(id, ch); if (files.length) this.files.set(id, files); return id; }
  async edit(id, m) { if (!this.messages.has(id)) throw new Error('Unknown Message'); this.messages.set(id, m); }
  async remove(id) { this.messages.delete(id); }
  async createVoice(name, opts) { const id = `v${++this.n}`; this.channels.set(id, { name, ...opts, kind: 'voice' }); return id; }
  async createText(name, opts) { const id = `t${++this.n}`; this.channels.set(id, { name, ...opts, kind: 'text' }); return id; }
  async createThread(parent, name) { const id = `th${++this.n}`; this.channels.set(id, { name, parent, kind: 'thread' }); return id; }
  async deleteChannel(id) { this.channels.delete(id); }
  async where(userId) { return this.voice.get(userId) ?? null; }
  async download(url) { return Buffer.from(`image:${url}`); }
  postedIn(ch) { return [...this.where_].filter(([, c]) => c === ch).map(([id]) => this.messages.get(id)); }
}

const config = { rankedChannelId: QUEUE, rankedResultsChannelId: RESULTS, staffRoleIds: ['staff'], rankedReadySeconds: 300, rankedCloseSeconds: 15, siteUrl: '' };
const quiet = { info() {}, warn() {}, error(...a) { throw new Error(a.join(' ')); } };
const setup = (store = new FileStore()) => {
  const io = new FakeIo();
  const clock = new FakeClock();
  const ranked = new Ranked({ io, store, config, clock, log: quiet });
  return { io, clock, ranked, store };
};
const A = { id: 'A', name: 'Alice' };
const B = { id: 'B', name: 'Bob' };
const C = { id: 'C', name: 'Cat' };
const shot = { url: 'https://cdn/x.png', name: 'x.png', contentType: 'image/png' };

async function toPlaying(env) {
  await env.ranked.start();
  await env.ranked.button('rq:join', A);
  await env.ranked.button('rq:join', B);
  const f = [...env.ranked.fixtures.values()][0];
  env.io.voice.set('A', f.voiceId);
  env.io.voice.set('B', f.voiceId);
  await env.ranked.button(`rr:${f.id}`, A);
  await env.ranked.button(`rr:${f.id}`, B);
  return f;
}

test('queue holds two, then resets; a fixture gets a named voice channel and a locked ready-up chat', async () => {
  const env = setup();
  await env.ranked.start();
  const card = () => env.io.messages.get(env.ranked.cardId);
  assert.match(card().embeds[0].description, /1v1 queue · 0\/2/);
  assert.match((await env.ranked.button('rq:join', A)).ephemeral, /Queued/);
  assert.match((await env.ranked.button('rq:join', A)).ephemeral, /already in the queue/);
  assert.match(card().embeds[0].description, /1\/2/);
  assert.match((await env.ranked.button('rq:join', B)).ephemeral, /Match found/);
  assert.equal(env.ranked.queue.length, 0, 'the queue reset for the next pair');
  assert.match(card().embeds[0].description, /0\/2/);
  // Someone else can queue straight away.
  await env.ranked.button('rq:join', C);
  assert.equal(env.ranked.queue.length, 1);
  assert.match((await env.ranked.button('rq:join', A)).ephemeral, /already in a 1v1/);

  const f = [...env.ranked.fixtures.values()][0];
  assert.equal(env.io.channels.get(f.voiceId).name, '1v1 - Alice VS Bob (Game 1)');
  assert.deepEqual(env.io.channels.get(f.voiceId).allow, ['A', 'B']);
  assert.deepEqual(env.io.channels.get(f.voiceId).roles, ['staff']);
  assert.equal(env.io.channels.get(f.textId).name, '1v1-game-1');
  const ready = env.io.messages.get(f.readyMsgId);
  assert.deepEqual(ready.allowedMentions.users, ['A', 'B']);
  assert.equal(ready.components[0].components[0].custom_id, `rr:${f.id}`);
});

test('ready up needs the voice channel; both ready opens the result thread', async () => {
  const env = setup();
  await env.ranked.start();
  await env.ranked.button('rq:join', A);
  await env.ranked.button('rq:join', B);
  const f = [...env.ranked.fixtures.values()][0];
  assert.match((await env.ranked.button(`rr:${f.id}`, A)).ephemeral, /Join the voice channel/);
  env.io.voice.set('A', f.voiceId);
  assert.match((await env.ranked.button(`rr:${f.id}`, A)).ephemeral, /Waiting for your opponent/);
  assert.match((await env.ranked.button(`rr:${f.id}`, C)).ephemeral, /Only the two players/);
  // Leaving the voice channel un-readies.
  env.io.voice.delete('A');
  await env.ranked.voiceLeft(f.voiceId, 'A');
  assert.equal(f.ready.size, 0);
  env.io.voice.set('A', f.voiceId);
  env.io.voice.set('B', f.voiceId);
  await env.ranked.button(`rr:${f.id}`, A);
  await env.ranked.button(`rr:${f.id}`, B);
  assert.equal(f.phase, 'playing');
  assert.equal(env.io.channels.get(f.threadId).parent, f.textId, 'the thread is in the fixture chat');
  assert.equal(env.io.channels.get(f.threadId).name, 'Game 1: Alice vs Bob');
  assert.equal(env.io.messages.get(f.resultMsgId).components[0].components[0].custom_id, `rres:${f.id}`);
});

test('both report the same winner with screenshots: RP, staff post, every temporary channel deleted', async () => {
  const env = setup();
  const f = await toPlaying(env);
  const form = await env.ranked.button(`rres:${f.id}`, A);
  assert.equal(form.modal.custom_id, `rrm:${f.id}`);
  assert.equal(form.modal.components[1].component.type, 19, 'a required file upload');
  assert.match((await env.ranked.button(`rres:${f.id}`, C)).ephemeral, /Only the two players/);
  // A screenshot is required.
  assert.match((await env.ranked.modal(`rrm:${f.id}`, A, { winner: 'a', file: null })).ephemeral, /screenshot/);
  assert.match((await env.ranked.modal(`rrm:${f.id}`, A, { winner: 'a', file: shot })).ephemeral, /Waiting for your opponent/);
  assert.match((await env.ranked.modal(`rrm:${f.id}`, B, { winner: 'a', file: shot })).ephemeral, /confirmed/);

  // RP: placement game, ±50.
  assert.equal(env.store.rating('A').rating, 1050);
  assert.equal(env.store.rating('B').rating, 950);
  const game = await env.store.getGame('r1');
  assert.equal(game.winner, 'a');
  // Staff channel: result with both screenshots.
  const posts = [...env.io.where_].filter(([, c]) => c === RESULTS);
  assert.equal(posts.length, 1);
  assert.match(env.io.messages.get(posts[0][0]).embeds[0].title, /Alice beat Bob/);
  assert.equal(env.io.files.get(posts[0][0]).length, 2);
  // Channels go after a short pause; the queue and results channels aren't touched.
  assert.ok(env.io.channels.has(f.voiceId));
  await env.clock.advance(15_000, env.ranked);
  assert.ok(!env.io.channels.has(f.voiceId) && !env.io.channels.has(f.textId) && !env.io.channels.has(f.threadId));
  assert.equal(env.ranked.fixtures.size, 0);
});

test('different winners: staff decide from the results channel; placements then ±20', async () => {
  const env = setup();
  const f = await toPlaying(env);
  await env.ranked.modal(`rrm:${f.id}`, A, { winner: 'a', file: shot });
  assert.match((await env.ranked.modal(`rrm:${f.id}`, B, { winner: 'b', file: shot })).ephemeral, /staff will decide/);
  assert.equal(f.phase, 'disputed');
  const dispute = env.io.messages.get(f.disputeMsgId);
  assert.deepEqual(dispute.allowedMentions.roles, ['staff']);
  assert.match((await env.ranked.button(`rstaff:${f.id}:b`, { id: 'X', name: 'X', isStaff: false })).ephemeral, /Only staff/);
  await env.ranked.button(`rstaff:${f.id}:b`, { id: 'S', name: 'Sam', isStaff: true });
  assert.equal(env.store.rating('B').rating, 1050);
  assert.equal((await env.store.getGame('r1')).decidedBy.by, 'staff');

  // Placement maths over more games: after 5 games it's ±20.
  const store = new FileStore();
  for (let i = 0; i < 6; i++) {
    const e = setup(store);
    e.ranked.lastNumber = i;
    const g = await toPlaying(e);
    await e.ranked.modal(`rrm:${g.id}`, A, { winner: 'a', file: shot });
    await e.ranked.modal(`rrm:${g.id}`, B, { winner: 'a', file: shot });
  }
  assert.equal(store.rating('A').rating, 1000 + 5 * 50 + 20);
  assert.equal(store.rating('B').rating, 1000 - 5 * 50 - 20);
});

test("ready timeout: cancelled with no RP change, and whoever readied goes back to the queue", async () => {
  const env = setup();
  await env.ranked.start();
  await env.ranked.button('rq:join', A);
  await env.ranked.button('rq:join', B);
  const f = [...env.ranked.fixtures.values()][0];
  env.io.voice.set('A', f.voiceId);
  await env.ranked.button(`rr:${f.id}`, A);
  await env.clock.advance(300_000, env.ranked);
  assert.equal(f.phase, 'cancelled');
  assert.deepEqual(env.ranked.queue.map((p) => p.id), ['A']);
  assert.equal(env.store.ratings().length, 0);
  assert.ok(env.io.postedIn(RESULTS).some((m) => /cancelled/.test(m.embeds?.[0]?.title ?? '')));
  await env.clock.advance(15_000, env.ranked);
  assert.ok(!env.io.channels.has(f.voiceId));
});

test('/rp and /rpleaderboard', async () => {
  const env = setup();
  assert.match(env.ranked.rating({ id: 'A', name: 'Alice' }).content, /hasn't played a 1v1/);
  const f = await toPlaying(env);
  await env.ranked.modal(`rrm:${f.id}`, A, { winner: 'a', file: shot });
  await env.ranked.modal(`rrm:${f.id}`, B, { winner: 'a', file: shot });
  assert.match(env.ranked.rating({ id: 'A', name: 'Alice' }).embeds[0].title, /placing 1\/5 \(1050 RP\)/);
  const board = env.ranked.leaderboard();
  assert.match(board.embeds[0].description, /Nobody has finished placements/);
  assert.match(board.embeds[0].fields[0].value, /Alice · 1\/5/);
});
