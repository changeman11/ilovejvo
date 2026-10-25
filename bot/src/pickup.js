// The pickup game manager: sign-up queue -> random mode -> ready check -> captains -> draft -> team
// voice channels -> result -> Elo. Players sign up / withdraw with the menu on the queue card. It doesn't know about discord.js; it talks to Discord through `io`:
//
// Optional `live` (site-queue.js) links the queue to the I<3JVO website:
//   live.joined(entry)  someone signed up (entry.from: 'discord' | 'site')
//   live.left(id)       someone is no longer signed up (withdrew, was picked, was dropped)
//   live.publish(state) the queue, ready checks, drafts and games on, for the site's pickup page
//   live.voted(id, size) someone's mode vote changed (size, or null for no vote)
//   live.modeSet(fixed) the admin-set mode changed ({ size, once } or null)
//
//   io.post(message, channelId?) -> messageId    io.edit(messageId, message, channelId?)
//   io.remove(messageId)                          (no channelId = the #pickup channel)
//   io.createVoice(name, { allow: [userIds] }) -> channelId   (locked: only those users and admins
//                                                              can join; everyone can see it)
//   io.createText(name, { allow: [userIds] }) -> channelId    (locked: only they and admins see it)
//   io.renameChannel(channelId, name)             io.deleteChannel(channelId)
//   io.channelSize(channelId) -> number of people in it (-1 if the channel is gone)
//   io.move(userId, channelId) -> true, or false if they aren't in a voice channel
//
// and saves through `store` (FileStore or FirestoreStore). Every event runs one at a time (run()),
// so two clicks at the same moment can't trip over each other.
import { fittingModes, minPlayers, maxPlayers, modeLabel, pickMode, projectedMode } from './logic/modes.js';
import { createDraft, applyPick, currentSide, isComplete } from './logic/draft.js';
import { randomTeams, randomNeeded } from './logic/random-teams.js';
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
  constructor({ io, store, config, clock = systemClock, rng = Math.random, log = console, live = null }) {
    Object.assign(this, { io, store, config, clock, rng, log, live });
    this.publishTimer = null;
    this.lastPublished = '';
    this.votes = new Map(); // userId -> team size they voted for (signed-up players only)
    this.randomVotes = new Set(); // userIds who voted for random teams instead of a draft
    this.fixedMode = null; // { size, once } when an admin set the mode (/pickup setmode)
    this.queue = new Map(); // userId -> { id, name, joinedAt, fake }  (everyone signed up)
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
    this.chain = result.catch((err) => this.log.error('[pickup]', err)).then(() => this.publishSoon());
    return result;
  }

  // ---------- the website's live view (when `live` is set) ----------
  // After anything happens, send the new state to the site (at most every 1.5 s, only if changed).
  publishSoon() {
    if (!this.live || this.publishTimer) return;
    this.publishTimer = this.clock.setTimeout(() => {
      this.publishTimer = null;
      this.publishNow();
    }, 1500);
  }

  // force: send even if nothing changed (a heartbeat, so the site can tell the bot is running).
  publishNow({ force = false } = {}) {
    if (!this.live) return;
    const state = this.liveState();
    const json = JSON.stringify({ ...state, updatedAt: 0 });
    if (!force && json === this.lastPublished) return;
    this.lastPublished = json;
    Promise.resolve(this.live.publish(state)).catch((err) => this.log.warn('[pickup] could not update the site:', err.message));
  }

  liveState() {
    const names = (ids, match) => ids.map((id) => match.names[id]);
    const side = (g, s) => g.teams[s].players.map((p) => p.name);
    return {
      queue: this.readyList().map((p) => ({ id: p.id, name: p.name, from: p.from ?? 'discord', joinedAt: p.joinedAt })),
      countdownEndsAt: this.countdown?.endsAt ?? null,
      matches: [...this.matches.values()].map((m) => ({
        id: m.id,
        size: m.size,
        phase: m.phase,
        deadline: m.deadline,
        players: m.players.map((p) => ({ id: p.id, name: p.name, ready: m.confirmed.has(p.id) })),
        teams: m.phase === 'draft' ? { a: names(m.state.teams.a, m), b: names(m.state.teams.b, m) } : null,
        randomVotes: m.randomVotes?.size ?? m.players.filter((p) => this.randomVotes.has(p.id)).length,
        randomNeeded: randomNeeded(m.players.length),
      })),
      games: [...this.games.values()]
        .filter((g) => LIVE.includes(g.status))
        .map((g) => ({ number: g.number, size: g.size, status: g.status, a: side(g, 'a'), b: side(g, 'b') })),
      modes: this.config.modes,
      modeVotes: this.voteTally(),
      randomVotes: this.readyList().filter((p) => this.randomVotes.has(p.id)).length,
      next: projectedMode({ readyCount: this.readyList().length, modes: this.config.modes, tally: this.voteTally(), needed: this.config.modeVotesNeeded, fixed: this.fixedMode?.size ?? null }),
      modeVotesNeeded: this.config.modeVotesNeeded,
      fixedMode: this.fixedMode?.size ?? null,
      fixedModeOnce: Boolean(this.fixedMode?.once),
      readySeconds: this.config.readySeconds,
      updatedAt: this.clock.now(),
    };
  }

  // Took someone off the sign-up list (tells the site).
  unqueue(id) {
    this.votes.delete(id);
    this.randomVotes.delete(id);
    if (this.queue.delete(id)) this.live?.left(id);
  }

  // { size: count } of mode votes from signed-up players who are waiting (all modes, for display).
  voteTally() {
    const tally = {};
    for (const p of this.readyList()) {
      const s = this.votes.get(p.id);
      if (s) tally[s] = (tally[s] ?? 0) + 1;
    }
    return tally;
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
    // An admin-set mode starts as soon as there are exactly enough for it.
    if (this.fixedMode) return { min: this.fixedMode.size * 2, max: this.fixedMode.size * 2 };
    return { min: minPlayers(this.config.modes), max: maxPlayers(this.config.modes) };
  }

  readyList() {
    return [...this.queue.values()]
      .filter((p) => !this.busy.has(p.id))
      .sort((x, y) => x.joinedAt - y.joinedAt || (x.id < y.id ? -1 : 1));
  }

  // ---------- events (called by the Discord layer) ----------

  start() {
    return this.run(async () => {
      for (const game of await this.store.openGames()) this.track(game);
      for (const game of [...this.games.values()]) await this.cleanupChannels(game);
      this.queueMessageId = this.store.getMeta('queueMessageId') ?? null;
      this.fixedMode = this.store.getMeta('fixedMode') ?? null;
      // Edit the card that's already there (a new message would mark #pickup unread on every
      // restart); a new one is only posted if it's gone.
      await this.queueChanged({ immediate: true, repost: false });
    });
  }

  // Someone joined a voice channel: if it's their ready-up channel, that confirms them.
  joined(channelId, id) {
    return this.event(async () => {
      const match = this.matches.get(this.lobbies.get(channelId));
      if (match) await this.onLobbyJoin(match, id);
    });
  }

  // Someone left a voice channel: a ready-up channel or a team channel.
  left(channelId, id) {
    return this.event(async () => {
      const match = this.matches.get(this.lobbies.get(channelId));
      if (match) return this.onLobbyLeave(match, id);
      if (this.oldLobbies.has(channelId)) return this.removeLobby(channelId);
      const game = this.games.get(this.channelGame.get(channelId));
      if (game) await this.cleanupChannels(game);
    });
  }

  // The Sign up / Withdraw menu on the queue card. Returns { ephemeral: 'text' } for that person.
  select(customId, value, user) {
    return this.run(async () => {
      if (customId === 'mode') {
        const reply = this.voteMode(user.id, value);
        this.renderQueueSoon();
        return reply;
      }
      if (customId === 'teams') {
        const reply = this.voteRandom(user.id, value === 'random');
        this.renderQueueSoon();
        return reply;
      }
      if (customId !== 'queue') return { ephemeral: "That menu isn't used any more." };
      const reply = value === 'join' ? await this.signUp(user.id, user.name) : await this.withdraw(user.id);
      this.renderQueueSoon(); // also resets the menu on everyone's screen
      return reply;
    }).catch((err) => {
      this.log.error('[pickup] menu', err);
      return { ephemeral: `Something went wrong: ${err.message}` };
    });
  }

  // "Vote for the next mode" menu. value: a team size, or 'none'.
  voteMode(id, value) {
    if (this.fixedMode) return { ephemeral: `An admin has set the mode to ${modeLabel(this.fixedMode.size)}${this.fixedMode.once ? ' for the next game' : ''}, so votes are paused.` };
    if (!this.queue.has(id) || this.busy.has(id)) return { ephemeral: 'Sign up first (the menu above), then vote for the mode you want.' };
    if (value === 'none') {
      this.votes.delete(id);
      this.live?.voted(id, null);
      return { ephemeral: 'Vote removed: any mode is fine.' };
    }
    const size = Number(value);
    if (!this.config.modes.includes(size)) return { ephemeral: "That mode isn't on." };
    this.votes.set(id, size);
    this.live?.voted(id, size);
    const count = this.voteTally()[size] ?? 0;
    const need = this.config.modeVotesNeeded;
    return { ephemeral: `Voted ${modeLabel(size)} (${count} vote${count === 1 ? '' : 's'}). ${count >= need ? 'That’s enough: it’s the next game’s mode if it has the most votes and enough players.' : `${need - count} more vote${need - count === 1 ? '' : 's'} and it’s picked (when there are enough players).`}` };
  }

  // "How should teams be made?" menu: random teams (on) or the captains' draft (off).
  voteRandom(id, on) {
    if (!this.queue.has(id) || this.busy.has(id)) return { ephemeral: 'Sign up first (the menu above), then vote.' };
    if (on) this.randomVotes.add(id);
    else this.randomVotes.delete(id);
    this.live?.votedRandom?.(id, on);
    return { ephemeral: on
      ? '🎲 Voted for random teams. If more than half of a game’s players vote for it, there’s no draft: teams are shuffled.'
      : '🧢 Voted for a captains’ draft.' };
  }

  // A random-teams vote changed on the website (site-queue.js).
  siteRandom(id, on) {
    return this.event(async () => {
      if (this.randomVotes.has(id) === Boolean(on)) return;
      this.voteRandom(id, Boolean(on));
      this.renderQueueSoon();
    });
  }

  // Votes and the admin-set mode, changed on the website (site-queue.js).
  siteVote(id, size) {
    return this.event(async () => {
      if ((this.votes.get(id) ?? null) === (size ?? null)) return;
      this.voteMode(id, size ? String(size) : 'none');
      this.renderQueueSoon();
    });
  }

  siteSetMode(fixed) {
    return this.event(async () => {
      if (JSON.stringify(fixed ?? null) === JSON.stringify(this.fixedMode ?? null)) return;
      await this.setFixedMode(fixed, { fromSite: true });
      await this.queueChanged();
    });
  }

  // Sign-ups and withdrawals made on the website (site-queue.js).
  siteJoin(id, name, joinedAt) {
    return this.event(() => this.signUp(id, name, { joinedAt, from: 'site' }));
  }

  siteLeave(id) {
    return this.event(() => this.withdraw(id));
  }

  // Shortcuts used by the tests.
  join(id, name) {
    return this.event(() => this.signUp(id, name));
  }

  leave(id) {
    return this.event(() => this.withdraw(id));
  }

  // user: { id, name, isAdmin }. Returns { ephemeral: 'text' } to tell only that person something.
  button(customId, user) {
    return this.run(async () => {
      const [kind, id, arg] = String(customId).split(':');
      if (kind === 'pick') return this.onPick(id, arg, user);
      if (kind === 'res') return this.onResult(id, arg, user);
      if (kind === 'rnd') return this.onRandomVote(id, user);
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
      if (name === 'leaderboard') return views.leaderboardView(this.store.ratings(), this.config);
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
  async signUp(id, name, { joinedAt = this.clock.now(), from = 'discord' } = {}) {
    if (this.busy.has(id)) return { ephemeral: "You're in a game that's getting ready: join your ready-up channel." };
    if (this.queue.has(id)) return { ephemeral: `You're already signed up (#${this.position(id)} in the queue).` };
    const entry = { id, name, joinedAt, fake: false, from };
    this.queue.set(id, entry);
    this.live?.joined(entry);
    await this.queueChanged();
    return { ephemeral: this.busy.has(id) ? "✅ You're in a game! Join your ready-up channel." : `✅ Signed up. You're #${this.position(id)} in the queue.` };
  }

  async withdraw(id) {
    if (this.busy.has(id)) return { ephemeral: "You've been picked for a game. If you can't play, don't join the ready-up channel and the next player takes your place." };
    if (!this.queue.has(id)) return { ephemeral: "You weren't signed up." };
    this.unqueue(id);
    await this.queueChanged();
    return { ephemeral: 'Withdrawn from the queue.' };
  }

  position(id) {
    return this.readyList().findIndex((p) => p.id === id) + 1;
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

  // Start a game with the players who've waited longest. size: a team size (admin /pickup start),
  // or null: the admin-set mode, else a mode with enough votes, else a random mode that fits.
  async startGame(size = null) {
    const ready = this.readyList();
    const pick = size
      ? { size, by: 'admin' }
      : pickMode({
          readyCount: ready.length,
          modes: this.config.modes,
          votes: ready.map((p) => this.votes.get(p.id)).filter(Boolean),
          needed: this.config.modeVotesNeeded,
          fixed: this.fixedMode?.size ?? null,
          rng: this.rng,
        });
    if (!pick || ready.length < pick.size * 2) {
      await this.queueChanged();
      return null;
    }
    if (!size && pick.by === 'admin' && this.fixedMode?.once) await this.setFixedMode(null);
    await this.beginCheck(pick.size, ready.slice(0, pick.size * 2), pick.by);
    await this.queueChanged();
    return pick.size;
  }

  async setFixedMode(fixed, { fromSite = false } = {}) {
    this.fixedMode = fixed;
    if (!fromSite) this.live?.modeSet(fixed);
    try {
      await this.store.setMeta('fixedMode', fixed);
    } catch (err) {
      this.log.warn('[pickup] could not save the admin mode:', err.message);
    }
  }

  snapshot() {
    return {
      ready: this.readyList(),
      drafting: this.matches.size,
      countdownEndsAt: this.countdown?.endsAt ?? null,
      games: [...this.games.values()].sort((a, b) => a.number - b.number),
      votes: this.voteTally(),
      randomVotes: this.readyList().filter((p) => this.randomVotes.has(p.id)).length,
      fixedMode: this.fixedMode,
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
  async beginCheck(size, players, why = 'random') {
    const match = {
      id: `${this.clock.now().toString(36)}${(++this.seq).toString(36)}`,
      size,
      why, // how the mode was chosen: 'random' | 'votes' | 'admin'
      phase: 'check',
      players: players.map((p) => ({ ...p })),
      confirmed: new Set(players.filter((p) => p.fake).map((p) => p.id)), // pretend players are always ready
      dropped: [],
      lobbyId: null,
      chatId: null, // the locked match chat, where the ready-check card is
      messageId: null,
      deadline: 0,
      timer: null,
      round: 0,
      // Two ready checks of the same mode at once get numbered channels ("ready up · 2v2 #2").
      tag: (() => { const n = [...this.matches.values()].filter((m) => m.size === size).length; return n ? n + 1 : null; })(),
    };
    this.matches.set(match.id, match);
    for (const p of players) this.busy.set(p.id, match.id);
    this.log.info?.(`[pickup] ${modeLabel(size)} ready check: ${players.map((p) => p.name).join(', ')}`);
    try {
      await this.makeRoom(match);
    } catch (err) {
      // Give up until the queue changes again (no instant retry, so no loop of failures).
      await this.cancelMatch(match, "the bot couldn't set up the ready check");
      throw new Error(`Couldn't start the ready check: ${err.message}`);
    }
    if (this.allConfirmed(match)) await this.beginDraft(match);
  }

  // The locked ready-up voice channel and the locked match chat (only these players and admins),
  // with the ready-check card in the chat pinging everyone.
  async makeRoom(match) {
    const allow = this.realIds(match.players);
    match.lobbyId = await this.io.createVoice(views.lobbyChannelName(match), { allow });
    this.lobbies.set(match.lobbyId, match.id);
    match.chatId = await this.io.createText(views.chatChannelName(match), { allow });
    this.armCheckTimer(match);
    match.messageId = await this.io.post(views.checkView(match, this.config, { ping: allow }), match.chatId);
  }

  realIds(players) {
    return players.filter((p) => !p.fake).map((p) => p.id);
  }

  allConfirmed(match) {
    return match.players.every((p) => match.confirmed.has(p.id));
  }

  // While the check runs, look at who's in the ready-up channel every few seconds (a join Discord
  // didn't report still counts).
  armSweep(match) {
    if (match.sweep) this.clock.clearTimeout(match.sweep);
    match.sweep = this.clock.setTimeout(() => this.event(async () => {
      if (this.matches.get(match.id) !== match || match.phase !== 'check') return;
      const before = match.confirmed.size;
      await this.syncLobby(match);
      if (this.allConfirmed(match)) return this.beginDraft(match);
      if (match.confirmed.size !== before) await this.safeEdit(match.messageId, views.checkView(match, this.config), match.chatId);
      this.armSweep(match);
    }), 5000);
  }

  armCheckTimer(match) {
    if (match.timer) this.clock.clearTimeout(match.timer);
    if (this.io.membersIn) this.armSweep(match);
    const ms = this.config.readySeconds * 1000;
    const round = ++match.round;
    match.deadline = this.clock.now() + ms;
    match.timer = this.clock.setTimeout(() => this.event(() => this.checkTimeout(match.id, round)), ms);
  }

  async onLobbyJoin(match, id) {
    if (match.phase !== 'check' || !match.players.some((p) => p.id === id) || match.confirmed.has(id)) return;
    match.confirmed.add(id);
    // Discord sometimes doesn't tell the bot about a join (busy moments, several channels at once),
    // so whenever anyone joins, look at who's really in the channel too.
    await this.syncLobby(match);
    this.log.info?.(`[pickup] ${modeLabel(match.size)} ready check: ${match.players.find((p) => p.id === id)?.name} joined (${match.confirmed.size}/${match.players.length})`);
    if (this.allConfirmed(match)) return this.beginDraft(match);
    await this.safeEdit(match.messageId, views.checkView(match, this.config), match.chatId);
  }

  async onLobbyLeave(match, id) {
    const player = match.players.find((p) => p.id === id);
    if (!player) return;
    if (match.phase === 'check') {
      match.confirmed.delete(id); // they can come back before the time is up
      await this.safeEdit(match.messageId, views.checkView(match, this.config), match.chatId);
      return;
    }
    await this.cancelMatch(match, `${views.esc(player.name)} left the ready-up channel during the draft`, { exclude: id });
    await this.queueChanged();
  }

  // Counts everyone who's really in the ready-up channel as ready (in case Discord didn't send a
  // join). io.membersIn is optional (older fakes in tests don't have it).
  async syncLobby(match) {
    if (!this.io.membersIn || !match.lobbyId) return;
    const inside = await this.io.membersIn(match.lobbyId).catch(() => null);
    if (!inside) return;
    for (const p of match.players) if (inside.includes(p.id)) match.confirmed.add(p.id);
  }

  // Time's up: drop whoever isn't in the ready-up channel and pull in the next players in the queue.
  async checkTimeout(matchId, round) {
    const match = this.matches.get(matchId);
    if (!match || match.phase !== 'check' || match.round !== round) return;
    // Last look at who's actually in the channel before dropping anyone.
    await this.syncLobby(match);
    if (this.allConfirmed(match)) {
      this.log.info?.(`[pickup] ${modeLabel(match.size)} ready check: everyone was in the channel (a join wasn't reported)`);
      return this.beginDraft(match);
    }
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
    // The locked channels can't let new people in without extra permissions, so make new ones
    // for the new line-up and move the players who already confirmed into the new voice channel.
    const oldLobby = match.lobbyId;
    const oldChat = match.chatId;
    this.lobbies.delete(oldLobby);
    this.oldLobbies.add(oldLobby);
    await this.makeRoom(match);
    for (const p of match.players) {
      if (p.fake || !match.confirmed.has(p.id)) continue;
      const moved = await this.io.move(p.id, match.lobbyId).catch(() => false);
      if (!moved) match.confirmed.delete(p.id);
    }
    await this.removeLobby(oldLobby);
    await this.deleteChat(oldChat);
    await this.safeEdit(match.messageId, views.checkView(match, this.config, { ping: this.realIds(match.players) }), match.chatId);
    if (this.allConfirmed(match)) await this.beginDraft(match);
    await this.queueChanged();
  }

  // A no-show loses their place: out of the game and off the sign-up list.
  async dropPlayer(match, player) {
    match.players = match.players.filter((p) => p.id !== player.id);
    match.dropped.push(player.name);
    this.busy.delete(player.id);
    this.unqueue(player.id);
  }

  async deleteChat(chatId) {
    if (!chatId) return;
    try {
      await this.io.deleteChannel(chatId);
    } catch (err) {
      this.log.warn('[pickup] could not delete a match chat:', err.message);
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

  // Stop a ready check or draft. Everyone in it stays signed up, in their old places (except
  // `exclude`, who left mid-draft). The ready-up channel is deleted once it's empty.
  async cancelMatch(match, reason, { exclude = null } = {}) {
    if (match.timer) this.clock.clearTimeout(match.timer);
    if (match.sweep) this.clock.clearTimeout(match.sweep);
    this.matches.delete(match.id);
    if (match.lobbyId) this.lobbies.delete(match.lobbyId);
    for (const p of match.players) {
      if (this.busy.get(p.id) === match.id) this.busy.delete(p.id);
      if (p.id === exclude) {
        this.unqueue(p.id);
      } else {
        this.queue.set(p.id, { ...p });
        if (!p.fake) this.live?.joined({ ...p, from: 'discord' }); // makes sure the site still lists them
      }
    }
    // The match chat (with the ready check or draft in it) goes, so the notice is posted in #pickup.
    await this.io.post(views.matchCancelledView(match, reason)).catch(() => {});
    if (match.lobbyId) await this.removeLobby(match.lobbyId);
    await this.deleteChat(match.chatId);
    this.log.info?.(`[pickup] ${modeLabel(match.size)} cancelled: ${reason}`);
  }

  // ---------- draft ----------
  async beginDraft(match) {
    if (match.timer) this.clock.clearTimeout(match.timer);
    if (match.sweep) this.clock.clearTimeout(match.sweep);
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
    // Random teams: votes made while signed up count here. More than half = no draft.
    match.randomVotes = new Set(players.map((p) => p.id).filter((id) => this.randomVotes.has(id)));
    if (match.randomVotes.size >= randomNeeded(players.length)) {
      match.state = randomTeams({ players: players.map((p) => p.id), size: match.size, rng: this.rng });
      match.random = true;
      this.log.info?.(`[pickup] ${modeLabel(match.size)}: random teams (${match.randomVotes.size} votes)`);
      return this.finishDraft(match);
    }
    if (isComplete(state)) return this.finishDraft(match); // 1v1 if anyone ever sets MODES=1
    this.armPickTimer(match);
    // The draft happens in the match chat: a fresh card under the ready check, so the captains
    // get pinged. It turns into the game card (result buttons) when the draft is done.
    const checkCard = match.messageId;
    if (checkCard) await this.safeEdit(checkCard, views.checkDoneView(match, this.config), match.chatId);
    match.messageId = await this.io.post(views.draftView(match), match.chatId);
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

  // "🎲 Random teams" on the draft card: a player in this draft votes; more than half = the draft
  // stops and everyone except the two captains is shuffled onto the teams.
  async onRandomVote(matchId, user) {
    const match = this.matches.get(matchId);
    if (!match || match.phase !== 'draft') return { ephemeral: 'This draft is over.' };
    if (!match.players.some((p) => p.id === user.id)) return { ephemeral: 'Only players in this draft can vote.' };
    match.randomVotes ??= new Set();
    if (match.randomVotes.has(user.id)) {
      match.randomVotes.delete(user.id);
      await this.safeEdit(match.messageId, views.draftView(match), match.chatId);
      return { ephemeral: 'Vote taken back: the draft carries on.' };
    }
    match.randomVotes.add(user.id);
    // Test mode: pretend players agree.
    for (const id of match.fakes) match.randomVotes.add(id);
    const need = randomNeeded(match.players.length);
    if (match.randomVotes.size >= need) {
      match.state = randomTeams({ players: match.players.map((p) => p.id), size: match.size, captains: match.state.captains, rng: this.rng });
      match.random = true;
      match.note = '🎲 Random teams: the players voted';
      this.log.info?.(`[pickup] ${modeLabel(match.size)}: random teams voted mid-draft`);
      await this.finishDraft(match);
      return null;
    }
    await this.safeEdit(match.messageId, views.draftView(match), match.chatId);
    return { ephemeral: `🎲 Voted for random teams (${match.randomVotes.size}/${need}).` };
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
    await this.safeEdit(match.messageId, views.draftView(match), match.chatId);
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
      this.unqueue(id); // they're off to play; they sign up again after the game
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
      ...(match.random ? { random: true } : {}),
      votes: {},
      winner: null,
      decidedBy: null,
      changes: {},
      channels: {},
      messageId: match.messageId,
      messageChannel: match.chatId ?? null, // the match chat (null = #pickup)
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
    // The match chat stays as this game's chat until the result is in.
    if (match.chatId) {
      game.channels.chat = match.chatId;
      this.channelGame.set(match.chatId, game.id);
      await this.io.renameChannel(match.chatId, views.gameChatName(game)).catch((err) => this.log.warn('[pickup] could not rename the match chat:', err.message));
      await this.store.saveGame(game).catch(() => {});
    }
    this.log.info?.(`[pickup] game #${number} ${modeLabel(game.size)} started`);
    if (game.messageId) await this.safeEdit(game.messageId, views.gameView(game, { problems }), game.messageChannel);
    else game.messageId = await this.io.post(views.gameView(game, { problems }), game.messageChannel);
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
    await this.safeEdit(next.messageId, views.gameView(next), next.messageChannel);
    if (next.status === 'disputed' && game.status !== 'disputed') await this.io.post(views.disputeView(next, this.config), next.messageChannel);
    return { ephemeral: next.status === 'disputed' ? 'Saved. Your report differs from the other captain\'s, so an admin will decide.' : 'Saved. Waiting for the other captain.' };
  }

  // Apply a result (or a correction). outcome: 'a' | 'b' | 'cancel'.
  async decide(game, outcome, decidedBy) {
    const now = this.clock.now();
    const wasDecided = game.status === 'done' || game.status === 'cancelled';
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
    await this.safeEdit(next.messageId, views.gameView(next), next.messageChannel);
    // The match chat is deleted with the team channels, so the record is posted in #pickup-results
    // (or #pickup when that's switched off).
    const resultsChannel = this.config.pickupResultsChannelId || undefined;
    await this.io.post(views.resultView(next, { corrected: wasDecided, config: this.config }), resultsChannel).catch((err) => this.log.warn('[pickup] could not post the result:', err.message));
    await this.cleanupChannels(next);
    // In #pickup itself, keep the queue card at the bottom (only needed when the result went there).
    await this.renderQueue({ repost: !resultsChannel });
    return next;
  }

  // Remove a finished game's team channels once they're empty.
  async cleanupChannels(game) {
    if (LIVE.includes(game.status)) return;
    const channels = { ...game.channels };
    for (const side of Object.keys(channels)) {
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
      const min = minPlayers(this.config.modes);
      if (ready.length < min) return { content: `Need at least ${min} ready to start (${ready.length} now).` };
      if (size && !fittingModes(ready.length, this.config.modes).includes(size)) {
        return { content: `${modeLabel(size)} needs ${size * 2} ready; there are ${ready.length}.` };
      }
      this.stopCountdown();
      const started = await this.startGame(size);
      return { content: started ? `Started a ${modeLabel(started)} draft.` : 'Not enough players to start.' };
    }
    if (sub === 'setmode') {
      const choice = options.choice ?? 'random';
      if (choice === 'random') {
        await this.setFixedMode(null);
        await this.queueChanged();
        return { content: 'Mode is back to the community: votes, or random when there aren’t enough votes.' };
      }
      const s = Number(choice);
      if (!this.config.modes.includes(s)) return { content: "That mode isn't on (MODES in .env)." };
      await this.setFixedMode({ size: s, once: Boolean(options.nextOnly) });
      await this.queueChanged();
      return { content: `Mode set to ${modeLabel(s)} ${options.nextOnly ? 'for the next game' : 'until you set it back to random'}. It starts as soon as ${s * 2} are signed up.` };
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
    // From the site's Bot panel (control.js): stop a ready check or draft (everyone goes back to the
    // queue in their old places), or take someone off the sign-up list.
    if (sub === 'cancelmatch') {
      const match = this.matches.get(String(options.match ?? ''));
      if (!match) return { content: 'That ready check or draft is already over.' };
      await this.cancelMatch(match, `an admin (${views.esc(user.name)}) cancelled it`);
      await this.queueChanged();
      return { content: `Cancelled the ${modeLabel(match.size)} ${match.phase === 'draft' ? 'draft' : 'ready check'}; everyone is back in the queue.` };
    }
    if (sub === 'remove') {
      const id = String(options.player ?? '');
      const p = this.queue.get(id);
      if (!p) return { content: 'They’re not signed up.' };
      if (this.busy.has(id)) return { content: `${p.name} is in a ready check or draft: cancel that first.` };
      this.unqueue(id);
      await this.queueChanged();
      return { content: `Took ${p.name} off the queue.` };
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
          this.unqueue(p.id);
          removed++;
        }
      }
      await this.queueChanged();
      return { content: `Removed ${removed} test player${removed === 1 ? '' : 's'}.` };
    }
    return { content: 'Unknown /pickup option.' };
  }

  async safeEdit(messageId, message, channelId) {
    if (!messageId) return;
    try {
      await this.io.edit(messageId, message, channelId);
    } catch (err) {
      this.log.warn('[pickup] could not edit a message:', err.message);
    }
  }
}
