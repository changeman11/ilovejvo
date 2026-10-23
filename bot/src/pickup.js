// The pickup game manager: queue -> random mode -> ready check -> captains -> draft -> team voice
// channels -> result -> Elo. It doesn't know about discord.js; it talks to Discord through `io`:
//
//   io.post(message) -> messageId        io.edit(messageId, message)     io.remove(messageId)
//   io.createVoice(name, { allow: [userIds] }) -> channelId   (locked: only those users and admins
//                                                              can join; everyone can see it)
//   io.deleteChannel(channelId)
//   io.channelSize(channelId) -> number of people in it (-1 if the channel is gone)
//   io.move(userId, channelId) -> true, or false if they aren't in a voice channel
//   io.where(userId) -> the voice channel they're in, or null
//   io.disconnect(userId) -> takes them out of voice
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
    this.busy = new Map(); // userId -> matchId  (in a ready check or draft, so not counted as ready)
    this.matches = new Map(); // matchId -> ready check or draft (see beginCheck / beginDraft)
    this.lobbies = new Map(); // locked ready-up voice channel id -> matchId
    this.oldLobbies = new Set(); // ready-up channels to delete once they're empty
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

  // members: people already in the queue channel when the bot starts.
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

  // Someone joined a voice channel: the queue channel, or a ready-up channel (to confirm).
  joined(channelId, id, name) {
    return this.event(async () => {
      if (channelId === this.config.queueChannelId) return this.onQueueJoin(id, name);
      const match = this.matches.get(this.lobbies.get(channelId));
      if (match) await this.onLobbyJoin(match, id);
    });
  }

  // Someone left a voice channel: the queue, a ready-up channel, or a team channel.
  left(channelId, id) {
    return this.event(async () => {
      if (channelId === this.config.queueChannelId) return this.onQueueLeave(id);
      const match = this.matches.get(this.lobbies.get(channelId));
      if (match) return this.onLobbyLeave(match, id);
      if (this.oldLobbies.has(channelId)) return this.removeLobby(channelId);
      const game = this.games.get(this.channelGame.get(channelId));
      if (game) await this.cleanupChannels(game);
    });
  }

  // Shortcuts for the queue channel (used by the tests).
  join(id, name) {
    return this.joined(this.config.queueChannelId, id, name);
  }

  leave(id) {
    return this.left(this.config.queueChannelId, id);
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

  // Bot shutting down: send players in ready checks and drafts back to the queue.
  shutdown() {
    return this.event(async () => {
      this.stopCountdown();
      if (this.renderTimer) this.clock.clearTimeout(this.renderTimer);
      for (const match of [...this.matches.values()]) await this.cancelMatch(match, 'the bot is restarting');
    });
  }

  // ---------- queue ----------
  async onQueueJoin(id, name) {
    if (this.queue.has(id)) return;
    this.queue.set(id, { id, name, joinedAt: this.clock.now(), fake: false });
    await this.queueChanged();
  }

  async onQueueLeave(id) {
    if (!this.queue.has(id)) return;
    this.queue.delete(id);
    await this.queueChanged();
  }

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

  // Start a game with the players who've waited longest. size: a team size, or null for random.
  async startGame(size = null) {
    const ready = this.readyList();
    const chosen = size ?? chooseMode(ready.length, this.config.modes, this.rng);
    if (!chosen || ready.length < chosen * 2) {
      await this.queueChanged();
      return null;
    }
    await this.beginCheck(chosen, ready.slice(0, chosen * 2));
    await this.queueChanged();
    return chosen;
  }

  snapshot() {
    return {
      ready: this.readyList(),
      drafting: this.matches.size,
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

  // ---------- ready check ----------
  // A game was found: make a locked "ready up" voice channel that only these players (and admins)
  // can join, and ping them. Each one confirms by joining it. Once everyone's in, the draft starts.
  // After READY_SECONDS, anyone missing is dropped and the next in the queue takes their place.
  async beginCheck(size, players) {
    const match = {
      id: `${this.clock.now().toString(36)}${(++this.seq).toString(36)}`,
      size,
      phase: 'check',
      players: players.map((p) => ({ ...p })),
      confirmed: new Set(players.filter((p) => p.fake).map((p) => p.id)), // pretend players are always ready
      dropped: [],
      lobbyId: null,
      messageId: null,
      deadline: 0,
      timer: null,
      round: 0,
    };
    this.matches.set(match.id, match);
    for (const p of players) this.busy.set(p.id, match.id);
    this.log.info?.(`[pickup] ${modeLabel(size)} ready check: ${players.map((p) => p.name).join(', ')}`);
    try {
      match.lobbyId = await this.io.createVoice(views.lobbyChannelName(match), { allow: this.realIds(match.players) });
      this.lobbies.set(match.lobbyId, match.id);
      this.armCheckTimer(match);
      match.messageId = await this.io.post(views.checkView(match, this.config, { ping: this.realIds(match.players) }));
    } catch (err) {
      // Give up until the queue changes again (no instant retry, so no loop of failures).
      await this.cancelMatch(match, "the bot couldn't set up the ready check");
      throw new Error(`Couldn't start the ready check: ${err.message}`);
    }
    if (this.allConfirmed(match)) await this.beginDraft(match);
  }

  realIds(players) {
    return players.filter((p) => !p.fake).map((p) => p.id);
  }

  allConfirmed(match) {
    return match.players.every((p) => match.confirmed.has(p.id));
  }

  armCheckTimer(match) {
    if (match.timer) this.clock.clearTimeout(match.timer);
    const ms = this.config.readySeconds * 1000;
    const round = ++match.round;
    match.deadline = this.clock.now() + ms;
    match.timer = this.clock.setTimeout(() => this.event(() => this.checkTimeout(match.id, round)), ms);
  }

  async onLobbyJoin(match, id) {
    if (match.phase !== 'check' || !match.players.some((p) => p.id === id) || match.confirmed.has(id)) return;
    match.confirmed.add(id);
    if (this.allConfirmed(match)) return this.beginDraft(match);
    await this.safeEdit(match.messageId, views.checkView(match, this.config));
  }

  async onLobbyLeave(match, id) {
    const player = match.players.find((p) => p.id === id);
    if (!player) return;
    if (match.phase === 'check') {
      match.confirmed.delete(id); // they can come back before the time is up
      await this.safeEdit(match.messageId, views.checkView(match, this.config));
      return;
    }
    await this.cancelMatch(match, `${views.esc(player.name)} left the ready-up channel during the draft`);
    await this.queueChanged();
  }

  // Time's up: drop whoever isn't in the ready-up channel and pull in the next players in the queue.
  async checkTimeout(matchId, round) {
    const match = this.matches.get(matchId);
    if (!match || match.phase !== 'check' || match.round !== round) return;
    const missing = match.players.filter((p) => !match.confirmed.has(p.id));
    for (const p of missing) await this.dropPlayer(match, p);
    const replacements = this.readyList().slice(0, missing.length);
    if (replacements.length < missing.length) {
      await this.cancelMatch(match, `${missing.map((p) => views.esc(p.name)).join(', ')} didn't join in time, and there aren't enough players in the queue to replace them`);
      await this.queueChanged();
      return;
    }
    for (const p of replacements) {
      match.players.push({ ...p });
      this.busy.set(p.id, match.id);
      if (p.fake) match.confirmed.add(p.id);
    }
    // The locked channel can't let new people in without extra permissions, so make a new one
    // for the new line-up and move the players who already confirmed into it.
    const oldLobby = match.lobbyId;
    match.lobbyId = await this.io.createVoice(views.lobbyChannelName(match), { allow: this.realIds(match.players) });
    this.lobbies.set(match.lobbyId, match.id);
    this.lobbies.delete(oldLobby);
    this.oldLobbies.add(oldLobby);
    for (const p of match.players) {
      if (p.fake || !match.confirmed.has(p.id)) continue;
      const moved = await this.io.move(p.id, match.lobbyId).catch(() => false);
      if (!moved) match.confirmed.delete(p.id);
    }
    await this.removeLobby(oldLobby);
    this.armCheckTimer(match);
    await this.safeEdit(match.messageId, views.checkView(match, this.config));
    const pinged = this.realIds(replacements);
    if (pinged.length) await this.io.post(views.replacementView(match, pinged, this.config));
    if (this.allConfirmed(match)) await this.beginDraft(match);
    await this.queueChanged();
  }

  // A no-show loses their place: out of the game and the queue (and out of the queue channel, so
  // they don't get picked again while away).
  async dropPlayer(match, player) {
    match.players = match.players.filter((p) => p.id !== player.id);
    match.dropped.push(player.name);
    this.busy.delete(player.id);
    this.queue.delete(player.id);
    if (player.fake) return;
    try {
      if ((await this.io.where(player.id)) === this.config.queueChannelId) await this.io.disconnect(player.id);
    } catch (err) {
      this.log.warn(`[pickup] could not remove ${player.name} from the queue channel:`, err.message);
    }
  }

  // Delete an old ready-up channel once nobody's in it (it's checked again when someone leaves).
  async removeLobby(channelId) {
    const size = await this.io.channelSize(channelId);
    if (size > 0) {
      this.oldLobbies.add(channelId);
      return;
    }
    this.oldLobbies.delete(channelId);
    if (size === 0) {
      try {
        await this.io.deleteChannel(channelId);
      } catch (err) {
        this.log.warn(`[pickup] could not delete ready-up channel ${channelId}:`, err.message);
      }
    }
  }

  // Stop a ready check or draft. Players in the ready-up channel go back to the queue channel in
  // their old places; players who never left the queue keep their places too.
  async cancelMatch(match, reason) {
    if (match.timer) this.clock.clearTimeout(match.timer);
    this.matches.delete(match.id);
    if (match.lobbyId) this.lobbies.delete(match.lobbyId);
    for (const p of match.players) {
      if (this.busy.get(p.id) === match.id) this.busy.delete(p.id);
      if (p.fake) {
        this.queue.set(p.id, { ...p });
        continue;
      }
      const where = await this.io.where(p.id).catch(() => null);
      if (where === this.config.queueChannelId) {
        this.queue.set(p.id, { ...p });
      } else if (match.lobbyId && where === match.lobbyId) {
        this.queue.set(p.id, { ...p }); // before the move, so the join event changes nothing
        const moved = await this.io.move(p.id, this.config.queueChannelId).catch(() => false);
        if (!moved) this.queue.delete(p.id);
      } else {
        this.queue.delete(p.id);
      }
    }
    if (match.messageId) await this.safeEdit(match.messageId, views.matchCancelledView(match, reason));
    if (match.lobbyId) await this.removeLobby(match.lobbyId);
    this.log.info?.(`[pickup] ${modeLabel(match.size)} cancelled: ${reason}`);
  }

  // ---------- draft ----------
  async beginDraft(match) {
    if (match.timer) this.clock.clearTimeout(match.timer);
    const players = match.players;
    const state = createDraft({ players: players.map((p) => p.id), size: match.size, rng: this.rng, style: this.config.draftOrder });
    Object.assign(match, {
      phase: 'draft',
      state,
      names: Object.fromEntries(players.map((p) => [p.id, p.name])),
      fakes: new Set(players.filter((p) => p.fake).map((p) => p.id)),
      note: `🪙 Coin flip: ${views.esc(players.find((p) => p.id === state.captains[state.first]).name)} picks first.`,
      timer: null,
    });
    this.log.info?.(`[pickup] ${modeLabel(match.size)} draft: everyone's ready`);
    if (isComplete(state)) return this.finishDraft(match); // 1v1 if anyone ever sets MODES=1
    this.armPickTimer(match);
    // A fresh message, so the captains get pinged.
    const old = match.messageId;
    match.messageId = await this.io.post(views.draftView(match));
    if (old) await this.io.remove(old).catch(() => {});
    this.fakeCaptainPicks(match);
  }

  armPickTimer(match) {
    if (match.timer) this.clock.clearTimeout(match.timer);
    const ms = this.config.pickSeconds * 1000;
    const turn = match.state.turn;
    match.deadline = this.clock.now() + ms;
    match.timer = this.clock.setTimeout(() => this.event(() => this.autoPick(match.id, turn, "time ran out, so it's random")), ms);
  }

  // Test mode: a pretend captain picks at random after a moment.
  fakeCaptainPicks(match) {
    const side = currentSide(match.state);
    if (!side || !match.fakes.has(match.state.captains[side])) return;
    const turn = match.state.turn;
    this.clock.setTimeout(() => this.event(() => this.autoPick(match.id, turn, 'test player')), 1500);
  }

  async autoPick(matchId, turn, why) {
    const match = this.matches.get(matchId);
    if (!match || match.phase !== 'draft' || match.state.turn !== turn) return;
    const side = currentSide(match.state);
    const pool = match.state.pool;
    const playerId = pool[Math.floor(this.rng() * pool.length)];
    await this.doPick(match, side, playerId, `${views.esc(match.names[match.state.captains[side]])} got ${views.esc(match.names[playerId])} (${why})`);
  }

  async onPick(matchId, playerId, user) {
    const match = this.matches.get(matchId);
    if (!match || match.phase !== 'draft') return { ephemeral: 'This draft is over.' };
    const side = currentSide(match.state);
    const captain = match.state.captains[side];
    const isCaptain = user.id === match.state.captains.a || user.id === match.state.captains.b;
    // Admins can pick for an away captain, but not while they're a captain in this draft themselves.
    if (user.id !== captain && (isCaptain || !user.isAdmin)) return { ephemeral: `It's ${match.names[captain]}'s pick.` };
    if (!match.state.pool.includes(playerId)) return { ephemeral: 'That player has already been picked.' };
    const by = user.id === captain ? '' : ` (picked for them by ${views.esc(user.name)})`;
    await this.doPick(match, side, playerId, `${views.esc(match.names[captain])} picked ${views.esc(match.names[playerId])}${by}`);
    return null;
  }

  async doPick(match, side, playerId, note) {
    match.state = applyPick(match.state, side, playerId);
    match.note = note;
    if (isComplete(match.state)) {
      await this.finishDraft(match);
      return;
    }
    this.armPickTimer(match);
    await this.safeEdit(match.messageId, views.draftView(match));
    this.fakeCaptainPicks(match);
  }

  // Draft done: save the game, make the two locked team voice channels and move everyone in.
  async finishDraft(match) {
    if (match.timer) this.clock.clearTimeout(match.timer);
    this.matches.delete(match.id);
    const lobbyId = match.lobbyId;
    if (lobbyId) this.lobbies.delete(lobbyId);
    const { state, names } = match;
    for (const id of state.players) {
      this.busy.delete(id);
      this.queue.delete(id); // they're off to play; they queue again by rejoining the queue channel
    }
    const number = Math.max(this.store.nextGameNumber(), this.lastNumber + 1);
    this.lastNumber = number;
    const team = (side) => ({
      captain: state.captains[side],
      players: state.teams[side].map((id) => ({ id, name: names[id], ...(match.fakes.has(id) ? { fake: true } : {}) })),
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
      messageId: match.messageId,
    };
    const problems = [];
    for (const side of ['a', 'b']) {
      try {
        const allow = game.teams[side].players.filter((p) => !p.fake).map((p) => p.id);
        game.channels[side] = await this.io.createVoice(views.teamChannelName(game, side), { allow });
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
    if (lobbyId) await this.removeLobby(lobbyId);
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
