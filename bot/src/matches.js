// Match threads: a Discord thread for every I<3JVO match (MATCH_THREADS=1, needs STORE=firebase).
//
// - When a match opens for votes on the site (rules/flow.js: the event has started, both teams'
//   earlier matches are done), the bot starts a thread for it in the match channel, posts the match
//   card (teams, squads with 👑 captains, the votes so far) and pings both squads.
// - Players vote in the thread: "Report score" opens a form (set scores + screenshots). The bot
//   checks it's a player on one of the two teams (their site profile's Discord ID), then saves the
//   vote to the site exactly like the site would (events/{e}/submissions, `via: 'discord'`),
//   publishing the score in the same save when it matches the other team's vote. Captains can
//   press "Confirm their score". Screenshots are copied to Firebase Storage and posted in the thread.
// - Votes made on the site show on the card too: the bot watches the site live (site-watch.js).
// - No score yet? Every MATCH_REMIND_MINUTES the bot pings the team(s) that still have to vote
//   (both teams if the scores don't match), up to MATCH_REMIND_MAX times, then pings admins once.
// - Once the score is in, the card shows the final score; the thread is locked and archived
//   MATCH_CLOSE_MINUTES later.
//
// Threads are remembered in matchThreads/{eventId}__{fixtureId} (public: the match page links to
// the thread), so a restart picks up where it left off.
//
// io (discord-io.js matchIo):
//   io.createThread(name) -> threadId        io.post(message, threadId, files?) -> messageId
//   io.edit(messageId, message, threadId)     io.close(threadId)        io.download(url) -> Buffer
//   io.guildId, io.channelId
// site: SiteWatch (bundles(), teams, players, events). rest: the bot's FirestoreRest.
import {
  threadDocId, formatOf, isApprovedTeam, readScore, profileOf, squadOf, isCaptain, openMatches,
  reminderDue, voteDoc, agreedResult, toConfirm, tallyVotes, matchState,
} from './logic/matches.js';
import * as views from './match-views.js';

const systemClock = { now: () => Date.now(), setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (t) => clearInterval(t) };
const TICK = 30 * 1000;
const IMAGE = /^image\/(png|jpeg|webp|gif)$/;
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

export class MatchThreads {
  constructor({ io, site, rest, config, log = console, clock = systemClock }) {
    Object.assign(this, { io, site, rest, config, log, clock });
    this.threads = new Map(); // docId -> matchThreads doc
    this.cards = new Map(); // docId -> JSON of the card as last posted (not saved)
    this.chain = Promise.resolve();
  }

  run(fn) {
    const result = this.chain.then(fn);
    this.chain = result.catch((err) => this.log.error('[matches]', err));
    return result;
  }

  async idle() {
    let seen;
    do {
      seen = this.chain;
      await seen;
    } while (seen !== this.chain);
  }

  async start() {
    for (const { id, data } of await this.rest.list('matchThreads')) this.threads.set(id, data);
    this.timer = this.clock.setInterval(() => this.sync(), TICK);
    this.timer?.unref?.();
    this.log.info?.(`[matches] match threads in <#${this.io.channelId}> (${[...this.threads.values()].filter((t) => t.status !== 'closed').length} open)`);
    return this.sync();
  }

  stop() {
    if (this.timer) this.clock.clearInterval(this.timer);
  }

  // Look at everything again (the site changed, or the clock ticked).
  sync() {
    return this.run(() => this.syncNow()).catch(() => {});
  }

  // ---------- what a match looks like right now ----------
  view(id) {
    const t = this.threads.get(id);
    const eventId = t?.eventId ?? id.split('__')[0];
    const fixtureId = t?.fixtureId ?? id.split('__').slice(1).join('__');
    const b = this.site.bundles().find((x) => x.event.id === eventId);
    const f = b?.fixtures.find((x) => x.id === fixtureId);
    if (!b || !f) return null;
    const players = [...this.site.players.values()];
    const home = this.site.teams.get(f.homeTeamId) ?? null;
    const away = this.site.teams.get(f.awayTeamId) ?? null;
    const subs = (b.submissions ?? []).filter((s) => s.fixtureId === f.id);
    const playersById = {};
    for (const p of players) {
      const team = p.teamId === f.homeTeamId ? home : p.teamId === f.awayTeamId ? away : null;
      playersById[p.id] = { ...p, captain: isCaptain(team, p) };
    }
    const site = this.config.siteUrl;
    return {
      id, b, f, home, away, subs, playersById,
      homeSquad: squadOf(f.homeTeamId, home, players),
      awaySquad: squadOf(f.awayTeamId, away, players),
      votes: tallyVotes(subs, f),
      result: b.results[f.id] ?? null,
      format: formatOf(b, f),
      url: site ? `${site}/match/${encodeURIComponent(b.event.id)}/${encodeURIComponent(f.id)}` : '',
    };
  }

  async save(id, changes) {
    const t = { ...(this.threads.get(id) ?? {}), ...changes, updatedAt: this.clock.now() };
    this.threads.set(id, t);
    await this.rest.commit([{ path: `matchThreads/${id}`, data: t }]).catch((err) => this.log.warn('[matches] could not save a thread:', err.message));
    return t;
  }

  async syncNow() {
    if (!this.site.ready()) return; // still loading: don't take "not there yet" for "gone"
    const now = this.clock.now();
    // 1. New threads for matches that just opened.
    for (const b of this.site.bundles()) {
      for (const f of openMatches(b, now)) {
        const id = threadDocId(b.event.id, f.id);
        const t = this.threads.get(id);
        if (t && t.status !== 'closed') continue;
        await this.open(id).catch((err) => this.log.error(`[matches] couldn't start the thread for ${id}:`, err.message));
      }
    }
    // 2. Keep the others up to date.
    for (const [id, t] of [...this.threads]) {
      if (t.status === 'closed') continue;
      try {
        await this.update(id, t, now);
      } catch (err) {
        this.log.warn(`[matches] ${id}:`, err.message);
      }
    }
  }

  async open(id) {
    const m = this.view(id);
    if (!m) return;
    const threadId = await this.io.createThread(views.threadName(m));
    const messageId = await this.io.post(views.matchCard(m, this.config, { ping: true }), threadId);
    // Remembered as the plain card, so the next look doesn't edit it just to drop the pings.
    this.cards.set(id, JSON.stringify(views.matchCard(m, this.config)));
    const now = this.clock.now();
    await this.save(id, {
      eventId: m.b.event.id, fixtureId: m.f.id, guildId: this.io.guildId, channelId: this.io.channelId, threadId, messageId,
      url: `https://discord.com/channels/${this.io.guildId}/${threadId}`,
      status: 'open', prompts: 0, lastPromptAt: now, adminPingedAt: null, doneAt: null, closedAt: null, createdAt: now,
    });
    this.log.info?.(`[matches] thread started: ${m.home?.name} vs ${m.away?.name} (${m.b.event.title})`);
  }

  async update(id, t, now) {
    const event = this.site.events.get(t.eventId);
    const m = this.view(id);
    if (!m) {
      // The match was taken off the schedule, or its event is finished, cancelled, unpublished or
      // deleted -> close up. (An event that's still upcoming but outside the watch window: leave it.)
      const watched = this.site.bundles().some((x) => x.event.id === t.eventId);
      if (!watched && event?.status === 'upcoming' && event.published) return;
      if (t.status === 'open') await this.finish(id, t, null, now);
      else if (t.status === 'done' && now - (t.doneAt ?? 0) >= this.config.matchCloseMinutes * 60000) await this.close(id, t, now);
      return;
    }
    await this.drawCard(id, t, m);
    if (m.result) {
      if (t.status === 'open') await this.finish(id, t, m, now);
      else if (now - (t.doneAt ?? 0) >= this.config.matchCloseMinutes * 60000) await this.close(id, t, now);
      return;
    }
    if (t.status === 'done') t = await this.save(id, { status: 'open', doneAt: null }); // the score was removed
    // Reminders while the match is open and still has no score.
    if (matchState(m.b, m.f, now).state !== 'open') return;
    const due = reminderDue({ thread: t, votes: m.votes, home: m.homeSquad, away: m.awaySquad, now, everyMinutes: this.config.matchRemindMinutes, max: this.config.matchRemindMax });
    if (!due) return;
    if (due.admins) {
      if (this.config.adminRoleIds.length) await this.io.post(views.adminPing(m, this.config), t.threadId);
      await this.save(id, { adminPingedAt: now });
      return;
    }
    await this.io.post(views.reminder(m, due, this.config), t.threadId);
    await this.save(id, { prompts: due.n, lastPromptAt: now });
  }

  async drawCard(id, t, m, extra = {}) {
    const card = views.matchCard({ ...m, ...extra }, this.config);
    const json = JSON.stringify(card);
    if (this.cards.get(id) === json) return;
    await this.io.edit(t.messageId, card, t.threadId);
    this.cards.set(id, json);
  }

  // m: the match with its score, or null when it was taken off the schedule.
  async finish(id, t, m, now) {
    await this.io.post(views.finalNote(m ?? { result: null }), t.threadId).catch(() => {});
    await this.save(id, { status: 'done', doneAt: now });
  }

  async close(id, t, now) {
    await this.io.close(t.threadId).catch((err) => this.log.warn('[matches] could not close a thread:', err.message));
    await this.save(id, { status: 'closed', closedAt: now });
  }

  // ---------- votes from Discord ----------
  // Who's asking, and can they vote on this match? -> { m, profile, team } or { error }
  check(id, user) {
    const m = this.view(id);
    if (!m) return { error: 'This match isn’t on any more.' };
    if (m.result) return { error: 'The score for this match is already in.' };
    const profile = profileOf(user.id, [...this.site.players.values()]);
    const site = this.config.siteUrl || 'the I<3JVO site';
    if (!profile?.uid) return { error: `Your Discord isn’t linked to an I<3JVO profile yet. Sign in with Discord at ${site}/me first.` };
    const team = this.site.teams.get(profile.teamId);
    if (!isApprovedTeam(team) || (team.id !== m.f.homeTeamId && team.id !== m.f.awayTeamId)) {
      return { error: `Only players on **${m.home?.name ?? 'TBC'}** or **${m.away?.name ?? 'TBC'}** can vote on this match.` };
    }
    const st = matchState(m.b, m.f, this.clock.now());
    if (st.state !== 'open') {
      const why = { before: 'the event hasn’t started yet', paused: 'admins have paused the event', break: 'it’s the break before the finals', waiting: 'an earlier match isn’t finished yet', draft: 'the fixtures aren’t locked yet' }[st.state] ?? 'it isn’t open';
      return { error: `Voting isn’t open for this match: ${why}.` };
    }
    return { m, profile, team };
  }

  // A button on the card. "Report score" answers with the form (straight away: Discord only waits
  // 3 seconds); "Confirm" saves.
  button(customId, user) {
    const [, action, ...rest] = String(customId).split(':');
    const id = rest.join(':');
    if (action === 'vote') {
      const c = this.check(id, user);
      if (c.error) return Promise.resolve({ ephemeral: c.error });
      const existing = c.m.subs.find((s) => s.id === `${c.m.f.id}__${c.profile.id}`) ?? null;
      return Promise.resolve({ modal: views.voteModal(c.m, existing) });
    }
    if (action === 'confirm') {
      return this.run(async () => {
        const c = this.check(id, user);
        if (c.error) return { ephemeral: c.error };
        if (!isCaptain(c.team, c.profile)) return { ephemeral: '👑 Only a team’s captain can confirm. Press **Report score** to vote instead.' };
        const theirs = toConfirm({ fixture: c.m.f, teamId: c.team.id, subs: c.m.subs });
        if (!theirs) return { ephemeral: 'There’s no score from the other team to confirm yet (or you’ve already agreed to it).' };
        return this.saveVote(c, theirs.sets, [], { confirming: true });
      }).catch((err) => ({ ephemeral: `Something went wrong: ${err.message}` }));
    }
    return Promise.resolve({ ephemeral: 'That button isn’t used any more.' });
  }

  // The form came back. values: { sets: '10-7, 8-10, 12-10', files: [{ url, name, contentType }] }
  modal(customId, user, values) {
    const id = String(customId).split(':').slice(1).join(':');
    return this.run(async () => {
      const c = this.check(id, user);
      if (c.error) return { ephemeral: c.error };
      const score = readScore(values.sets, c.m.format);
      if (score.error) return { ephemeral: `${score.error}\nPress **Report score** to try again.` };
      return this.saveVote(c, score.sets, values.files ?? []);
    }).catch((err) => ({ ephemeral: `Something went wrong: ${err.message}` }));
  }

  async saveVote({ m, profile, team }, sets, files, { confirming = false } = {}) {
    const now = this.clock.now();
    const e = m.b.event.id;
    const voteId = `${m.f.id}__${profile.id}`;
    const existing = m.subs.find((s) => s.id === voteId) ?? null;
    await this.rest.token(); // signed in, so rest.uid is the bot's
    const botUid = this.rest.uid;

    // Screenshots: copy them to the site (players/{id}/shot/...), and keep them to post here.
    const posted = [];
    let screenshotPaths = existing?.screenshotPaths ?? [];
    let failed = 0;
    const images = files.filter((f) => IMAGE.test(f.contentType ?? '')).slice(0, 3);
    if (images.length) {
      screenshotPaths = [];
      for (const [i, file] of images.entries()) {
        try {
          const data = await this.io.download(file.url);
          const path = `players/${profile.id}/shot/${now.toString(36)}${i}${Math.random().toString(36).slice(2, 6)}.${EXT[file.contentType]}`;
          await this.rest.upload(this.config.firebase.storageBucket, path, data, file.contentType);
          screenshotPaths.push(path);
          posted.push({ name: `match-${i + 1}.${EXT[file.contentType]}`, data });
        } catch (err) {
          failed++;
          this.log.warn('[matches] screenshot copy failed:', err.message);
        }
      }
      if (!screenshotPaths.length) screenshotPaths = existing?.screenshotPaths ?? [];
    }

    const vote = voteDoc({ fixture: m.f, player: profile, sets, screenshotPaths, existing, botUid, now });
    const agreed = agreedResult({ b: m.b, fixture: m.f, vote, voteId, subs: m.subs });
    const audit = (path, data, before) => ({
      path: `auditLog/${now.toString(36)}${Math.random().toString(36).slice(2, 12)}`,
      data: { by: botUid, action: before ? 'update' : 'create', path, before: before ?? null, after: data },
      serverTime: ['at'],
    });
    const votePath = `events/${e}/submissions/${voteId}`;
    const strip = (doc) => (doc ? Object.fromEntries(Object.entries(doc).filter(([k]) => k !== 'id')) : null);
    const writes = [{ path: votePath, data: vote, serverTime: ['updatedAt'] }, audit(votePath, vote, strip(existing))];
    if (agreed) {
      const resultPath = `events/${e}/results/${m.f.id}`;
      const result = { ...agreed, enteredBy: botUid, updatedBy: botUid };
      writes.push({ path: resultPath, data: result, serverTime: ['updatedAt', 'enteredAt'], mustNotExist: true }, audit(resultPath, result, null));
    }
    try {
      await this.rest.commit(writes);
    } catch (err) {
      this.log.warn('[matches] vote refused:', err.message);
      return { ephemeral: 'That vote couldn’t be saved: the score may already be in, or your club changed. Check the match page on the site.' };
    }

    // Show it in the thread (the card updates by itself when the site sees the vote).
    const t = this.threads.get(m.id);
    const who = `${isCaptain(team, profile) ? '👑 ' : ''}**${views.safeName(profile.displayName)}** (${views.safeName(team.name)})`;
    const line = confirming
      ? `👑 ${who} confirmed **${views.scoreOf(sets)}** (${views.setsLine(sets)}).`
      : `🗳️ ${who} voted **${views.scoreOf(sets)}** (${views.setsLine(sets)})${posted.length ? ' 📸' : ''}.`;
    if (t?.threadId) await this.io.post({ content: line, allowedMentions: { parse: [] } }, t.threadId, posted).catch(() => {});

    const other = team.id === m.f.homeTeamId ? m.away : m.home;
    const disputed = !agreed && m.subs.some((s) => s.teamId === other?.id);
    const note = failed ? `\n(${failed} screenshot${failed === 1 ? '' : 's'} couldn’t be copied: you can add ${failed === 1 ? 'it' : 'them'} on the site.)` : '';
    return { ephemeral: views.voteSaved({ agreed: Boolean(agreed), disputed, otherName: other?.name ?? 'the other team' }) + note };
  }
}
