// The 1v1 ranked queue: queue card -> two players -> locked voice + ready-up chat -> both ready
// -> result thread (both pick the winner and attach the scoreboard) -> RP -> results posted to the
// staff channel -> every temporary channel deleted. The queue and staff results channels stay.
//
// Talks to Discord through `io` (discord-io.js rankedIo):
//   io.post(message, channelId) -> messageId      io.edit(messageId, message, channelId)
//   io.createVoice(name, { allow, roles }) -> id   io.createText(name, { allow, roles }) -> id
//   io.createThread(channelId, name) -> id         io.deleteChannel(id)
//   io.where(userId) -> voice channel id or null   io.download(url) -> Buffer
// and saves through its own store (rankedRatings / rankedGames / pickupMeta/ranked).
// Optional `live` (site-queue.js RankedSiteQueue) links the 1v1 queue to the website:
//   live.joined(entry) / live.left(id) / live.publish(state)
import { rpDelta, tallyReports, isPlaced } from './logic/ranked.js';
import { applyChange, ranked as rankRecords } from './logic/ratings.js';
import * as views from './ranked-views.js';

const systemClock = { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (t) => clearTimeout(t) };
const LIVE = ['ready', 'playing', 'disputed'];

export class Ranked {
  constructor({ io, store, config, clock = systemClock, log = console, live = null }) {
    Object.assign(this, { io, store, config, clock, log, live });
    this.publishTimer = null;
    this.lastPublished = '';
    this.queue = []; // [{ id, name, at }], at most 2
    this.fixtures = new Map(); // id -> fixture (still going)
    this.voiceOf = new Map(); // voice channel id -> fixture id
    this.cardId = null;
    this.chain = Promise.resolve();
    this.lastNumber = 0;
  }

  run(fn) {
    const result = this.chain.then(fn);
    this.chain = result.catch((err) => this.log.error('[1v1]', err)).then(() => this.publishSoon());
    return result;
  }

  // ---------- the website (when `live` is set) ----------
  publishSoon() {
    if (!this.live || this.publishTimer) return;
    this.publishTimer = this.clock.setTimeout(() => {
      this.publishTimer = null;
      this.publishNow();
    }, 1500);
  }

  publishNow({ force = false } = {}) {
    if (!this.live) return;
    const state = {
      queue: this.queue.map((p) => ({ id: p.id, name: p.name, from: p.from ?? 'discord' })),
      fixtures: [...this.fixtures.values()].map((f) => ({ number: f.number, phase: f.phase, a: f.a.name, b: f.b.name, aId: f.a.id, bId: f.b.id, ready: f.ready.size })),
      readySeconds: this.config.rankedReadySeconds,
      updatedAt: this.clock.now(),
    };
    const json = JSON.stringify({ ...state, updatedAt: 0 });
    if (!force && json === this.lastPublished) return;
    this.lastPublished = json;
    Promise.resolve(this.live.publish(state)).catch((err) => this.log.warn('[1v1] could not update the site:', err.message));
  }

  // Sign-ups made or removed on the website.
  siteJoin(id, name) {
    return this.event(() => this.join({ id, name }, { from: 'site' }));
  }

  siteLeave(id) {
    return this.event(() => this.leave({ id }));
  }

  event(fn) {
    return this.run(fn).catch(() => {});
  }

  async idle() {
    let seen;
    do {
      seen = this.chain;
      await seen;
    } while (seen !== this.chain);
  }

  start() {
    return this.run(async () => {
      this.cardId = this.store.getMeta('queueMessageId') ?? null;
      await this.renderCard({ repost: true });
    });
  }

  // ---------- the queue card ----------
  async renderCard({ repost = false } = {}) {
    const message = views.queueCard({ queue: this.queue, fixtures: [...this.fixtures.values()], config: this.config });
    const ch = this.config.rankedChannelId;
    if (this.cardId) {
      try {
        if (!repost) return await this.io.edit(this.cardId, message, ch);
        await this.io.remove(this.cardId, ch);
      } catch {
        // gone: post a new one
      }
    }
    this.cardId = await this.io.post(message, ch);
    await this.store.setMeta('queueMessageId', this.cardId).catch(() => {});
  }

  activeFixtureOf(userId) {
    return [...this.fixtures.values()].find((f) => LIVE.includes(f.phase) && (f.a.id === userId || f.b.id === userId)) ?? null;
  }

  async join(user, { from = 'discord' } = {}) {
    if (this.activeFixtureOf(user.id)) {
      if (from === 'site') this.live?.left(user.id); // can't queue: clear their site sign-up
      return { ephemeral: 'You’re already in a 1v1. Finish it first.' };
    }
    if (this.queue.some((p) => p.id === user.id)) return { ephemeral: 'You’re already in the queue. Waiting for an opponent…' };
    const entry = { id: user.id, name: user.name, at: this.clock.now(), from };
    this.queue.push(entry);
    this.live?.joined(entry);
    if (this.queue.length >= 2) {
      const [a, b] = this.queue.splice(0, 2); // the queue resets for the next pair straight away
      this.live?.left(a.id);
      this.live?.left(b.id);
      await this.renderCard();
      await this.createFixture(a, b);
      return { ephemeral: `Match found! Check your ready-up channel.` };
    }
    await this.renderCard();
    return { ephemeral: '✅ Queued. Waiting for an opponent…' };
  }

  async leave(user) {
    const before = this.queue.length;
    this.queue = this.queue.filter((p) => p.id !== user.id);
    if (this.queue.length === before) return { ephemeral: 'You weren’t in the queue.' };
    this.live?.left(user.id);
    await this.renderCard();
    return { ephemeral: 'Left the queue.' };
  }

  // ---------- a fixture ----------
  async createFixture(a, b) {
    const number = Math.max(this.store.nextGameNumber(), this.lastNumber + 1);
    this.lastNumber = number;
    const f = {
      id: `r${number}`,
      number,
      a: { id: a.id, name: a.name },
      b: { id: b.id, name: b.name },
      phase: 'ready',
      ready: new Set(),
      reports: {},
      files: {},
      createdAt: this.clock.now(),
      deadline: this.clock.now() + this.config.rankedReadySeconds * 1000,
    };
    this.fixtures.set(f.id, f);
    const allow = [a.id, b.id];
    const roles = this.config.staffRoleIds;
    try {
      f.voiceId = await this.io.createVoice(views.voiceName(f), { allow, roles });
      this.voiceOf.set(f.voiceId, f.id);
      f.textId = await this.io.createText(views.textName(f), { allow, roles });
      f.readyMsgId = await this.io.post(views.readyCard(f, this.config, { ping: true }), f.textId);
    } catch (err) {
      this.log.error('[1v1] could not set up the fixture:', err.message);
      await this.cancel(f, "the bot couldn't make the channels");
      return;
    }
    f.timer = this.clock.setTimeout(() => this.event(() => this.readyTimeout(f.id)), this.config.rankedReadySeconds * 1000);
    await this.renderCard();
  }

  side(f, userId) {
    return f.a.id === userId ? 'a' : f.b.id === userId ? 'b' : null;
  }

  async pressReady(fixtureId, user) {
    const f = this.fixtures.get(fixtureId);
    if (!f || f.phase !== 'ready') return { ephemeral: 'This ready check is over.' };
    if (!this.side(f, user.id)) return { ephemeral: 'Only the two players can ready up.' };
    if ((await this.io.where(user.id)) !== f.voiceId) return { ephemeral: `Join the voice channel <#${f.voiceId}> first, then press Ready.` };
    f.ready.add(user.id);
    if (f.ready.size === 2) {
      await this.startPlaying(f);
      return { ephemeral: '✅ Both ready. Good luck!' };
    }
    await this.safeEdit(f.readyMsgId, views.readyCard(f, this.config), f.textId);
    return { ephemeral: '✅ Ready. Waiting for your opponent.' };
  }

  // Someone left a voice channel: un-ready them if it was their fixture's.
  voiceLeft(channelId, userId) {
    return this.event(async () => {
      const f = this.fixtures.get(this.voiceOf.get(channelId));
      if (!f || f.phase !== 'ready' || !f.ready.delete(userId)) return;
      await this.safeEdit(f.readyMsgId, views.readyCard(f, this.config), f.textId);
    });
  }

  async readyTimeout(fixtureId) {
    const f = this.fixtures.get(fixtureId);
    if (!f || f.phase !== 'ready') return;
    const readyOnes = [f.a, f.b].filter((p) => f.ready.has(p.id));
    await this.cancel(f, 'not both players readied up in time');
    // Whoever did ready up goes straight back to the front of the queue.
    for (const p of readyOnes) {
      if (!this.queue.some((q) => q.id === p.id)) this.queue.unshift({ ...p, at: this.clock.now() });
    }
    while (this.queue.length >= 2) {
      const [a, b] = this.queue.splice(0, 2);
      this.live?.left(a.id);
      this.live?.left(b.id);
      await this.createFixture(a, b);
    }
    await this.renderCard();
  }

  async startPlaying(f) {
    this.clock.clearTimeout(f.timer);
    f.phase = 'playing';
    await this.safeEdit(f.readyMsgId, views.readyCard(f, this.config), f.textId);
    f.threadId = await this.io.createThread(f.textId, views.threadName(f));
    f.resultMsgId = await this.io.post(views.resultCard(f, this.config, { ping: true }), f.threadId);
    await this.renderCard();
  }

  // "Report result" button: the form (who won + scoreboard screenshot).
  reportForm(fixtureId, user) {
    const f = this.fixtures.get(fixtureId);
    if (!f || !['playing', 'disputed'].includes(f.phase)) return { ephemeral: 'This fixture is over.' };
    if (!this.side(f, user.id)) return { ephemeral: 'Only the two players can report the result.' };
    return { modal: views.reportModal(f) };
  }

  // The form came back. file: { url, name, contentType } of the screenshot.
  async report(fixtureId, user, { winner, file }) {
    const f = this.fixtures.get(fixtureId);
    if (!f || !['playing', 'disputed'].includes(f.phase)) return { ephemeral: 'This fixture is over.' };
    const side = this.side(f, user.id);
    if (!side) return { ephemeral: 'Only the two players can report the result.' };
    if (!['a', 'b'].includes(winner)) return { ephemeral: 'Pick who won.' };
    if (!file?.url || !/^image\//.test(file.contentType ?? 'image/')) return { ephemeral: 'Attach a screenshot of the end-game scoreboard (an image).' };
    let data = null;
    try {
      data = await this.io.download(file.url);
    } catch (err) {
      this.log.warn('[1v1] could not download a screenshot:', err.message);
    }
    f.reports[side] = { winner, at: this.clock.now() };
    if (data) f.files[side] = { name: `game-${f.number}-${side}-${safeName(file.name)}`, data };
    // Evidence in the thread.
    await this.io.post(views.reportPosted(f, side, winner, f.files[side]?.name), f.threadId, f.files[side] ? [f.files[side]] : []).catch(() => {});
    const tally = tallyReports(f.reports);
    if (tally.status === 'agreed') {
      await this.finish(f, tally.winner, { by: 'players' });
      return { ephemeral: '✅ Result confirmed by both players.' };
    }
    if (tally.status === 'disputed') {
      if (f.phase !== 'disputed') {
        f.phase = 'disputed';
        f.disputeMsgId = await this.io.post(views.disputeCard(f, this.config), this.config.rankedResultsChannelId, Object.values(f.files));
      }
      await this.safeEdit(f.resultMsgId, views.resultCard(f, this.config), f.threadId);
      return { ephemeral: 'You and your opponent picked different winners, so staff will decide.' };
    }
    await this.safeEdit(f.resultMsgId, views.resultCard(f, this.config), f.threadId);
    return { ephemeral: '✅ Saved. Waiting for your opponent to report too.' };
  }

  // Staff buttons on a disputed fixture in the results channel: 'a' | 'b' | 'cancel'.
  async staffDecide(fixtureId, choice, user) {
    if (!user.isStaff) return { ephemeral: 'Only staff can decide results.' };
    const f = this.fixtures.get(fixtureId);
    if (!f || !LIVE.includes(f.phase)) return { ephemeral: 'That fixture is already finished.' };
    if (choice === 'cancel') {
      await this.cancel(f, `cancelled by staff (${user.name})`);
      return { ephemeral: 'Fixture cancelled, no RP change.' };
    }
    await this.finish(f, choice, { by: 'staff', name: user.name });
    return { ephemeral: 'Result saved.' };
  }

  // Apply RP, save, post to the staff results channel, and remove the temporary channels.
  async finish(f, winner, decidedBy) {
    this.clock.clearTimeout(f.timer);
    f.phase = 'done';
    const now = this.clock.now();
    const changes = {};
    const records = [];
    for (const side of ['a', 'b']) {
      const p = f[side];
      const record = this.store.rating(p.id);
      const won = side === winner;
      const delta = rpDelta(record, won);
      const after = applyChange(record, { won, delta }, now, p.name);
      records.push(after);
      changes[p.id] = { side, won, before: record.rating, delta, after: after.rating, placed: isPlaced(after), placement: !isPlaced(record) };
    }
    const game = {
      id: f.id, number: f.number, status: 'done', open: false, createdAt: f.createdAt, endedAt: now, winner,
      players: { a: f.a, b: f.b }, reports: f.reports, decidedBy, changes,
    };
    try {
      await this.store.saveResult(game, records);
    } catch (err) {
      this.log.error('[1v1] could not save the result:', err.message);
    }
    await this.io.post(views.resultPost(game, this.config), this.config.rankedResultsChannelId, Object.values(f.files)).catch((err) => this.log.warn('[1v1] could not post to the results channel:', err.message));
    if (f.disputeMsgId) await this.safeEdit(f.disputeMsgId, views.disputeSettled(game), this.config.rankedResultsChannelId);
    if (f.threadId) await this.io.post(views.closingNote(game), f.threadId).catch(() => {});
    this.log.info?.(`[1v1] game ${f.number}: ${f[winner].name} beat ${f[winner === 'a' ? 'b' : 'a'].name}`);
    await this.tidy(f);
  }

  async cancel(f, reason) {
    this.clock.clearTimeout(f.timer);
    f.phase = 'cancelled';
    await this.io.post(views.cancelNote(f, reason), this.config.rankedResultsChannelId).catch(() => {});
    if (f.textId) await this.io.post({ content: `❌ Fixture cancelled: ${reason}. These channels close in a few seconds.` }, f.textId).catch(() => {});
    this.log.info?.(`[1v1] game ${f.number} cancelled: ${reason}`);
    await this.tidy(f);
  }

  // Delete the thread, the ready-up chat and the voice channel (after a short pause to read).
  async tidy(f) {
    this.fixtures.delete(f.id);
    if (f.voiceId) this.voiceOf.delete(f.voiceId);
    await this.renderCard();
    const ids = [f.threadId, f.textId, f.voiceId].filter(Boolean);
    this.clock.setTimeout(() => this.event(async () => {
      for (const id of ids) await this.io.deleteChannel(id).catch((err) => this.log.warn('[1v1] could not delete a channel:', err.message));
    }), this.config.rankedCloseSeconds * 1000);
  }

  // ---------- commands ----------
  rating(player) {
    const list = rankRecords(this.store.ratings().filter((r) => r.games > 0));
    const i = list.findIndex((r) => r.discordId === player.id);
    const record = i >= 0 ? list[i] : { ...this.store.rating(player.id), name: player.name };
    return views.rpCard({ ...record, name: player.name || record.name }, i + 1, list.length, this.config);
  }

  leaderboard() {
    return views.rpLeaderboard(this.store.ratings(), this.config);
  }

  // ---------- Discord events ----------
  button(customId, user) {
    return this.run(async () => {
      const [kind, id, arg] = String(customId).split(':');
      if (kind === 'rq') return arg === 'leave' || id === 'leave' ? this.leave(user) : this.join(user);
      if (kind === 'rr') return this.pressReady(id, user);
      if (kind === 'rres') return this.reportForm(id, user);
      if (kind === 'rstaff') return this.staffDecide(id, arg, user);
      return { ephemeral: "That button isn't used any more." };
    }).catch((err) => ({ ephemeral: `Something went wrong: ${err.message}` }));
  }

  modal(customId, user, values) {
    return this.run(() => this.report(String(customId).split(':')[1], user, values)).catch((err) => ({ ephemeral: `Something went wrong: ${err.message}` }));
  }

  shutdown() {
    return this.event(async () => {
      for (const f of [...this.fixtures.values()]) await this.cancel(f, 'the bot is restarting');
    });
  }

  async safeEdit(messageId, message, channelId) {
    if (!messageId) return;
    try {
      await this.io.edit(messageId, message, channelId);
    } catch (err) {
      this.log.warn('[1v1] could not edit a message:', err.message);
    }
  }
}

const safeName = (name) => String(name ?? 'scoreboard.png').replace(/[^\w.-]+/g, '_').slice(-60) || 'scoreboard.png';
