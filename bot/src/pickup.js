// The pickup game manager: queue -> random mode -> captains -> draft -> team voice channels ->
// result -> Elo. It doesn't know about discord.js; it talks to Discord through `io`:
//
//   io.post(message) -> messageId        io.edit(messageId, message)     io.remove(messageId)
//   io.createVoice(name) -> channelId     io.deleteChannel(channelId)
//   io.channelSize(channelId) -> number of people in it (-1 if the channel is gone)
//   io.move(userId, channelId) -> true, or false if they aren't in a voice channel
//
// and saves through `store` (FileStore or FirestoreStore). Every event runs one at a time (run()),
// so two clicks at the same moment can't trip over each other.
import { chooseMode, fittingModes, minPlayers, maxPlayers, modeLabel } from './logic/modes.js';
import { createDraft, applyPick, currentSide, isComplete } from './logic/draft.js';
import { tallyVotes, OUTCOMES } from './logic/votes.js';
import { gameChanges, applyChange, revertChange } from './logic/ratings.js';
import * as views from './views.js';

const systemClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (t) => clearTimeout(t),
};

const LIVE = ['playing', 'disputed'];

export class Pickup {
  constructor({ io, store, config, clock = systemClock, rng = Math.random, log = console }) {
    Object.assign(this, { io, store, config, clock, rng, log });
    this.queue = new Map(); // userId -> { id, name, joinedAt, fake }  (everyone in the ready-up channel)
    this.busy = new Map(); // userId -> draftId  (in a draft right now, so not counted as ready)
    this.drafts = new Map(); // draftId -> { id, state, names, fakes, messageId, deadline, timer, note }
    this.games = new Map(); // gameId -> game  (games still going, or whose voice channels still exist)
    this.channelGame = new Map(); // team voice channel id -> gameId
    this.countdown = null; // { endsAt, timer }
    this.queueMessageId = null;
    this.renderTimer = null;
    this.chain = Promise.resolve();
    this.seq = 0;
    this.fakeCount = 0;
    this.lastNumber = 0;
  }

  // ---------- running things one at a time ----------
  run(fn) {
    const result = this.chain.then(fn);
    this.chain = result.catch((err) => this.log.error('[pickup]', err));
    return result;
  }

  // For events and timers: errors are already logged by run(), so don't pass them on.
  event(fn) {
    return this.run(fn).catch(() => {});
  }

  // Resolves once nothing is left to run (tests use this).
  async idle() {
    let seen;
    do {
      seen = this.chain;
      await seen;
    } while (seen !== this.chain);
  }

  limits() {
    return { min: minPlayers(this.config.modes), max: maxPlayers(this.config.modes) };
  }

  readyList() {
    return [...this.queue.values()]
      .filter((p) => !this.busy.has(p.id))
      .sort((x, y) => x.joinedAt - y.joinedAt || (x.id < y.id ? -1 : 1));
  }

  // ---------- events (called by the Discord layer) ----------

  // members: people already in the ready-up channel when the bot starts.
  start({ members = [] } = {}) {
    return this.run(async () => {
      for (const game of await this.store.openGames()) this.track(game);
      for (const game of [...this.games.values()]) await this.cleanupChannels(game);
      const now = this.clock.now();
      members.forEach((m, i) => this.queue.set(m.id, { id: m.id, name: m.name, joinedAt: now + i, fake: false }));
      this.queueMessageId = this.store.getMeta('queueMessageId') ?? null;
      await this.queueChanged({ immediate: true, repost: true });
    });
  }

  join(id, name) {
    return this.event(async () => {
      if (this.queue.has(id)) return;
      this.queue.set(id, { id, name, joinedAt: this.clock.now(), fake: false });
      await this.queueChanged();
    });
  }

  leave(id) {
    return this.event(async () => {
      if (!this.queue.has(id)) return;
      this.queue.delete(id);
      const draft = this.drafts.get(this.busy.get(id));
      if (draft) await this.cancelDraft(draft, `${views.esc(draft.names[id])} left the ready-up channel`);
      await this.queueChanged();
    });
  }

  // Someone left a voice channel; if it's a finished game's team channel and now empty, remove it.
  channelLeft(channelId) {
    return this.event(async () => {
      const game = this.games.get(this.channelGame.get(channelId));
      if (game) await this.cleanupChannels(game);
    });
  }

  // user: { id, name, isAdmin }. Returns { ephemeral: 'text' } to tell only that person something.
  button(customId, user) {
    return this.run(async () => {
      const [kind, id, arg] = String(customId).split(':');
      if (kind === 'pick') return this.onPick(id, arg, user);
      if (kind === 'res') return this.onResult(id, arg, user);
      return { ephemeral: "That button isn't used any more." };
    }).catch((err) => {
      this.log.error('[pickup] button', err);
      return { ephemeral: `Something went wrong: ${err.message}` };
    });
  }

  // Slash commands. Returns a message (plus `ephemeral: true` for private answers).
  command(name, options, user) {
    return this.run(async () => {
      if (name === 'queue') return { ...views.queueView(this.snapshot(), this.config), ephemeral: true };
      if (name === 'elo') return this.showRating(options.player ?? { id: user.id, name: user.name });
      if (name === 'leaderboard') return views.leaderboardView(this.store.ratings());
      if (name === 'pickup') {
        if (!user.isAdmin) return { content: 'Only admins can use /pickup.', ephemeral: true };
        return { ...(await this.adminCommand(options.sub, options, user)), ephemeral: true };
      }
      return { content: 'Unknown command.', ephemeral: true };
    }).catch((err) => {
      this.log.error('[pickup] command', err);
      return { content: `Something went wrong: ${err.message}`, ephemeral: true };
    });
  }

  // Bot shutting down: tell drafts in progress they're cancelled.
  shutdown() {
    return this.event(async () => {
      this.stopCountdown();
      if (this.renderTimer) this.clock.clearTimeout(this.renderTimer);
      for (const draft of [...this.drafts.values()]) await this.cancelDraft(draft, 'the bot is restarting');
    });
  }

  // ---------- queue ----------
  // immediate: redraw the queue message now instead of within a second; repost: at the bottom.
  async queueChanged({ immediate = false, repost = false } = {}) {
    const ready = this.readyList();
    const { min, max } = this.limits();
    if (ready.length >= max) {
      // Enough for the biggest mode: no need to wait.
      this.stopCountdown();
      await this.startGame();
      return;
    }
    if (ready.length >= min) {
      if (!this.countdown) this.startCountdown();
    } else {
      this.stopCountdown();
    }
    if (immediate) await this.renderQueue({ repost });
    else this.renderQueueSoon();
  }

  startCountdown() {
    const ms = this.config.countdownSeconds * 1000;
    const endsAt = this.clock.now() + ms;
    const timer = this.clock.setTimeout(() => this.event(() => this.countdownDone(endsAt)), ms);
    this.countdown = { endsAt, timer };
  }

  stopCountdown() {
    if (!this.countdown) return;
    this.clock.clearTimeout(this.countdown.timer);
    this.countdown = null;
  }

  async countdownDone(endsAt) {
    if (this.countdown?.endsAt !== endsAt) return;
    this.countdown = null;
    await this.startGame();
  }

  // Start a draft with the players who've waited longest. size: a team size, or null for random.
  async startGame(size = null) {
    const ready = this.readyList();
    const chosen = size ?? chooseMode(ready.length, this.config.modes, this.rng);
    if (!chosen || ready.length < chosen * 2) {
      await this.queueChanged();
      return null;
    }
    await this.beginDraft(chosen, ready.slice(0, chosen * 2));
    await this.queueChanged();
    return chosen;
  }

  snapshot() {
    return {
      ready: this.readyList(),
      drafting: this.drafts.size,
      countdownEndsAt: this.countdown?.endsAt ?? null,
      games: [...this.games.values()].sort((a, b) => a.number - b.number),
    };
  }

  // The queue message is edited at most once a second (Discord limits how fast bots edit).
  renderQueueSoon() {
    if (this.renderTimer) return;
    this.renderTimer = this.clock.setTimeout(() => {
      this.renderTimer = null;
      this.event(() => this.renderQueue());
    }, 1000);
  }

  // repost: post it again at the bottom of the channel (after a draft pushed it up).
  async renderQueue({ repost = false } = {}) {
    const message = views.queueView(this.snapshot(), this.config);
    if (this.queueMessageId) {
      try {
        if (!repost) {
          await this.io.edit(this.queueMessageId, message);
          return;
        }
        await this.io.remove(this.queueMessageId);
      } catch {
        // The old message was deleted: post a new one.
      }
    }
    this.queueMessageId = await this.io.post(message);
    try {
      await this.store.setMeta('queueMessageId', this.queueMessageId);
    } catch (err) {
      this.log.warn('[pickup] could not save the queue message id:', err.message);
    }
  }

  // ---------- draft ----------
  async beginDraft(size, players) {
    const id = `${this.clock.now().toString(36)}${(++this.seq).toString(36)}`;
    const state = createDraft({ players: players.map((p) => p.id), size, rng: this.rng, style: this.config.draftOrder });
    const draft = {
      id,
      state,
      names: Object.fromEntries(players.map((p) => [p.id, p.name])),
      fakes: new Set(players.filter((p) => p.fake).map((p) => p.id)),
      messageId: null,
      deadline: 0,
      timer: null,
      note: `🪙 Coin flip: ${views.esc(players.find((p) => p.id === state.captains[state.first]).name)} picks first.`,
    };
    this.drafts.set(id, draft);
    for (const p of players) this.busy.set(p.id, id);
    this.log.info?.(`[pickup] ${modeLabel(size)} draft: ${players.map((p) => p.name).join(', ')}`);
    if (isComplete(state)) return this.finishDraft(draft); // 1v1 if anyone ever sets MODES=1
    this.armPickTimer(draft);
    try {
      draft.messageId = await this.io.post(views.draftView(draft));
    } catch (err) {
      // Give up until the queue changes again (no instant retry, so no loop of failed posts).
      await this.cancelDraft(draft, "the bot couldn't post in the pickup channel");
      throw new Error(`Couldn't post the draft in the pickup channel: ${err.message}`);
    }
    this.fakeCaptainPicks(draft);
  }

  armPickTimer(draft) {
    if (draft.timer) this.clock.clearTimeout(draft.timer);
    const ms = this.config.pickSeconds * 1000;
    const turn = draft.state.turn;
    draft.deadline = this.clock.now() + ms;
    draft.timer = this.clock.setTimeout(() => this.event(() => this.autoPick(draft.id, turn, "time ran out, so it's random")), ms);
  }

  // Test mode: a pretend captain picks at random after a moment.
  fakeCaptainPicks(draft) {
    const side = currentSide(draft.state);
    if (!side || !draft.fakes.has(draft.state.captains[side])) return;
    const turn = draft.state.turn;
    this.clock.setTimeout(() => this.event(() => this.autoPick(draft.id, turn, 'test player')), 1500);
  }

  async autoPick(draftId, turn, why) {
    const draft = this.drafts.get(draftId);
    if (!draft || draft.state.turn !== turn) return;
    const side = currentSide(draft.state);
    const pool = draft.state.pool;
    const playerId = pool[Math.floor(this.rng() * pool.length)];
    await this.doPick(draft, side, playerId, `${views.esc(draft.names[draft.state.captains[side]])} got ${views.esc(draft.names[playerId])} (${why})`);
  }

  async onPick(draftId, playerId, user) {
    const draft = this.drafts.get(draftId);
    if (!draft) return { ephemeral: 'This draft is over.' };
    const side = currentSide(draft.state);
    const captain = draft.state.captains[side];
    const isCaptain = user.id === draft.state.captains.a || user.id === draft.state.captains.b;
    // Admins can pick for an away captain, but not while they're a captain in this draft themselves.
    if (user.id !== captain && (isCaptain || !user.isAdmin)) return { ephemeral: `It's ${draft.names[captain]}'s pick.` };
    if (!draft.state.pool.includes(playerId)) return { ephemeral: 'That player has already been picked.' };
    const by = user.id === captain ? '' : ` (picked for them by ${views.esc(user.name)})`;
    await this.doPick(draft, side, playerId, `${views.esc(draft.names[captain])} picked ${views.esc(draft.names[playerId])}${by}`);
    return null;
  }

  async doPick(draft, side, playerId, note) {
    draft.state = applyPick(draft.state, side, playerId);
    draft.note = note;
    if (isComplete(draft.state)) {
      await this.finishDraft(draft);
      return;
    }
    this.armPickTimer(draft);
    await this.safeEdit(draft.messageId, views.draftView(draft));
    this.fakeCaptainPicks(draft);
  }

  async cancelDraft(draft, reason) {
    if (draft.timer) this.clock.clearTimeout(draft.timer);
    this.drafts.delete(draft.id);
    for (const id of draft.state.players) if (this.busy.get(id) === draft.id) this.busy.delete(id);
    if (draft.messageId) await this.safeEdit(draft.messageId, views.draftCancelledView(draft, reason));
  }

  // Draft done: save the game, make the two team voice channels and move everyone in.
  async finishDraft(draft) {
    if (draft.timer) this.clock.clearTimeout(draft.timer);
    this.drafts.delete(draft.id);
    const { state, names } = draft;
    for (const id of state.players) {
      this.busy.delete(id);
      this.queue.delete(id); // they're off to play; they ready up again by rejoining the channel
    }
    const number = Math.max(this.store.nextGameNumber(), this.lastNumber + 1);
    this.lastNumber = number;
    const team = (side) => ({
      captain: state.captains[side],
      players: state.teams[side].map((id) => ({ id, name: names[id], ...(draft.fakes.has(id) ? { fake: true } : {}) })),
    });
    const game = {
      id: `g${number}`,
      number,
      size: state.size,
      status: 'playing',
      open: true,
      createdAt: this.clock.now(),
      endedAt: null,
      teams: { a: team('a'), b: team('b') },
      votes: {},
      winner: null,
      decidedBy: null,
      changes: {},
      channels: {},
      messageId: draft.messageId,
    };
    const problems = [];
    for (const side of ['a', 'b']) {
      try {
        game.channels[side] = await this.io.createVoice(views.teamChannelName(game, side));
      } catch (err) {
        problems.push(`Couldn't make a voice channel for ${views.teamName(game, side)} (${err.message}). Does the bot have Manage Channels?`);
      }
    }
    this.track(game);
    try {
      await this.store.createGame(game);
    } catch (err) {
      this.log.error('[pickup] could not save the new game:', err.message);
      problems.push(`Couldn't save the game (${err.message}). Reporting may fail if the bot restarts.`);
    }
    for (const side of ['a', 'b']) {
      const channelId = game.channels[side];
      if (!channelId) continue;
      for (const p of game.teams[side].players) {
        if (p.fake) continue;
        try {
          if (!(await this.io.move(p.id, channelId))) problems.push(`${p.name} isn't in voice, so they weren't moved.`);
        } catch (err) {
          problems.push(`Couldn't move ${p.name} (${err.message}). Does the bot have Move Members?`);
        }
      }
    }
    this.log.info?.(`[pickup] game #${number} ${modeLabel(game.size)} started`);
    if (game.messageId) await this.safeEdit(game.messageId, views.gameView(game, { problems }));
    else game.messageId = await this.io.post(views.gameView(game, { problems }));
    await this.renderQueue({ repost: true });
  }

  // ---------- results ----------
  track(game) {
    this.games.set(game.id, game);
    for (const channelId of Object.values(game.channels ?? {})) if (channelId) this.channelGame.set(channelId, game.id);
    this.lastNumber = Math.max(this.lastNumber, game.number ?? 0);
  }

  async findGame(id) {
    return this.games.get(id) ?? (await this.store.getGame(id));
  }

  captainSide(game, userId) {
    return ['a', 'b'].find((s) => game.teams[s].captain === userId) ?? null;
  }

  async onResult(gameId, outcome, user) {
    const game = await this.findGame(gameId);
    if (!game) return { ephemeral: "I can't find that game." };
    if (!OUTCOMES.includes(outcome)) return { ephemeral: "That button isn't used any more." };
    if (!LIVE.includes(game.status)) {
      return { ephemeral: `Game #${game.number} is already decided. Admins can change it with /pickup result.` };
    }
    const side = this.captainSide(game, user.id);
    if (!side) {
      if (!user.isAdmin) return { ephemeral: 'Only the two captains (or an admin) can report this game.' };
      await this.decide(game, outcome, { by: 'admin', userId: user.id, name: user.name });
      return { ephemeral: `Saved: game #${game.number}, ${outcome === 'cancel' ? 'cancelled' : `${views.teamName(game, outcome)} won`}.` };
    }
    const votes = { ...game.votes, [side]: outcome };
    // Test mode: a pretend captain agrees with the real one.
    const otherSide = side === 'a' ? 'b' : 'a';
    const otherCaptain = game.teams[otherSide].players.find((p) => p.id === game.teams[otherSide].captain);
    if (otherCaptain?.fake) votes[otherSide] = outcome;

    const tally = tallyVotes(votes);
    if (tally.status === 'agreed') {
      await this.decide({ ...game, votes }, tally.outcome, { by: 'captains' });
      return null;
    }
    const next = { ...game, votes, status: tally.status === 'disputed' ? 'disputed' : 'playing' };
    await this.store.saveGame(next);
    this.track(next);
    await this.safeEdit(next.messageId, views.gameView(next));
    if (next.status === 'disputed' && game.status !== 'disputed') await this.io.post(views.disputeView(next, this.config));
    return { ephemeral: next.status === 'disputed' ? 'Saved. Your report differs from the other captain\'s, so an admin will decide.' : 'Saved. Waiting for the other captain.' };
  }

  // Apply a result (or a correction). outcome: 'a' | 'b' | 'cancel'.
  async decide(game, outcome, decidedBy) {
    const now = this.clock.now();
    const records = new Map();
    const record = (id) => {
      if (!records.has(id)) records.set(id, this.store.rating(id));
      return records.get(id);
    };
    // An admin correcting a finished game: undo its old rating changes first.
    const old = game.status === 'done' ? game.changes ?? {} : {};
    for (const [id, change] of Object.entries(old)) records.set(id, revertChange(record(id), change, now));

    let changes = {};
    if (outcome !== 'cancel') {
      // Ratings from before this game: the saved ones when correcting, otherwise current ratings.
      const ratingOf = (p) => (p.fake ? this.config.startRating : old[p.id]?.before ?? record(p.id).rating);
      changes = gameChanges(game, outcome, ratingOf, this.config.k);
      for (const side of ['a', 'b']) {
        for (const p of game.teams[side].players) {
          const change = changes[p.id];
          if (!change) continue;
          const updated = applyChange(record(p.id), change, now, p.name);
          records.set(p.id, updated);
          change.after = updated.rating;
        }
      }
    }
    const next = {
      ...game,
      status: outcome === 'cancel' ? 'cancelled' : 'done',
      winner: outcome === 'cancel' ? null : outcome,
      changes,
      decidedBy,
      endedAt: now,
    };
    await this.store.saveResult(next, [...records.values()]);
    this.track(next);
    this.log.info?.(`[pickup] game #${next.number}: ${outcome === 'cancel' ? 'cancelled' : `${views.teamName(next, outcome)} won`} (${decidedBy.by})`);
    await this.safeEdit(next.messageId, views.gameView(next));
    await this.cleanupChannels(next);
    return next;
  }

  // Remove a finished game's team channels once they're empty.
  async cleanupChannels(game) {
    if (LIVE.includes(game.status)) return;
    const channels = { ...game.channels };
    for (const side of ['a', 'b']) {
      const channelId = channels[side];
      if (!channelId) continue;
      const size = await this.io.channelSize(channelId);
      if (size > 0) continue;
      if (size === 0) {
        try {
          await this.io.deleteChannel(channelId);
        } catch (err) {
          this.log.warn(`[pickup] could not delete voice channel ${channelId}:`, err.message);
          continue;
        }
      }
      this.channelGame.delete(channelId);
      delete channels[side];
    }
    const open = Object.keys(channels).length > 0;
    const next = { ...game, channels, open };
    if (!open) this.games.delete(game.id);
    else this.games.set(game.id, next);
    if (open !== game.open || Object.keys(channels).length !== Object.keys(game.channels ?? {}).length) {
      try {
        await this.store.saveGame(next);
      } catch (err) {
        this.log.warn('[pickup] could not save channel clean-up:', err.message);
      }
    }
  }

  // ---------- ratings ----------
  showRating(player) {
    const list = this.store.ratings();
    const index = list.findIndex((r) => r.discordId === player.id);
    const record = index >= 0 ? list[index] : { ...this.store.rating(player.id), name: player.name };
    return views.ratingView({ ...record, name: player.name || record.name }, index + 1, list.length, this.config);
  }

  // ---------- admin ----------
  async adminCommand(sub, options, user) {
    if (sub === 'start') {
      const ready = this.readyList();
      const size = options.mode ?? null;
      const { min } = this.limits();
      if (ready.length < min) return { content: `Need at least ${min} ready to start (${ready.length} now).` };
      if (size && !fittingModes(ready.length, this.config.modes).includes(size)) {
        return { content: `${modeLabel(size)} needs ${size * 2} ready; there are ${ready.length}.` };
      }
      this.stopCountdown();
      const started = await this.startGame(size);
      return { content: started ? `Started a ${modeLabel(started)} draft.` : 'Not enough players to start.' };
    }
    if (sub === 'result') {
      const game = await this.findGame(`g${options.game}`);
      if (!game) return { content: `There's no game #${options.game}.` };
      const outcome = options.winner;
      if (!OUTCOMES.includes(outcome)) return { content: 'Pick Team 1, Team 2 or Cancel.' };
      const same = (outcome === 'cancel' && game.status === 'cancelled') || (game.status === 'done' && game.winner === outcome);
      if (same) return { content: `Game #${game.number} already has that result.` };
      const next = await this.decide(game, outcome, { by: 'admin', userId: user.id, name: user.name });
      const text = outcome === 'cancel' ? 'cancelled, no Elo change' : `${views.teamName(next, outcome)} won, Elo updated`;
      return { content: `Game #${next.number}: ${text}.` };
    }
    if (sub === 'testfill') {
      if (!this.config.allowTestPlayers) return { content: 'Test players are off (set ALLOW_TEST_PLAYERS=1 in .env to use them).' };
      const count = Math.max(1, Math.min(11, options.count ?? 1));
      const now = this.clock.now();
      for (let i = 0; i < count; i++) {
        const n = ++this.fakeCount;
        this.queue.set(`test-${n}`, { id: `test-${n}`, name: `Test ${n}`, joinedAt: now + i, fake: true });
      }
      await this.queueChanged();
      return { content: `Added ${count} test player${count === 1 ? '' : 's'}.` };
    }
    if (sub === 'testclear') {
      let removed = 0;
      for (const p of [...this.queue.values()]) {
        if (p.fake && !this.busy.has(p.id)) {
          this.queue.delete(p.id);
          removed++;
        }
      }
      await this.queueChanged();
      return { content: `Removed ${removed} test player${removed === 1 ? '' : 's'}.` };
    }
    return { content: 'Unknown /pickup option.' };
  }

  async safeEdit(messageId, message) {
    if (!messageId) return;
    try {
      await this.io.edit(messageId, message);
    } catch (err) {
      this.log.warn('[pickup] could not edit a message:', err.message);
    }
  }
}
