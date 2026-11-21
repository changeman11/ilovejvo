// Event reminders in #match-threads (added 2026-11-21, EVENT_PINGS=0 turns them off): "finish your
// roster" pings 24 h and 2 h before an event for clubs short of players, a "check in now" (or
// "matches are open") ping to everyone at the start, and a reminder 10 minutes in for anyone still
// not checked in. See logic/event-pings.js. Checks every 2 minutes; reads only events within a
// day of starting. Sent stages are remembered in the store's meta: eventPings = { "eventId:kind": at }.
//
// io: { post(message) } (the match threads channel). site: SiteReader.
import { planPings, chunks } from './logic/event-pings.js';

export class EventPings {
  constructor({ io, site, store, config, log = console, now = () => Date.now() }) {
    Object.assign(this, { io, site, store, config, log, now });
    this.chain = Promise.resolve();
  }

  start() {
    this.timer = setInterval(() => this.sync(), 2 * 60 * 1000);
    this.timer.unref?.();
    return this.sync();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  sync() {
    const run = this.chain.then(() => this.syncNow());
    this.chain = run.catch((err) => this.log.warn('[event pings]', err.message));
    return run;
  }

  // Each event's reminders go in one post of its own ("📢 <event> · check-in & reminders") in the
  // #matches forum (or a thread, without a forum). Remembered as eventPingThreads = { eventId: threadId }.
  async postFor(event, message) {
    const map = { ...(this.store.getMeta('eventPingThreads') ?? {}) };
    if (map[event.id]) {
      try { await this.io.post(message, map[event.id]); return; } catch (err) { this.log.warn('[event pings] old post gone, making a new one:', err.message); }
    }
    if (!this.io.createThread) { await this.io.post(message); return; }
    const made = await this.io.createThread(`📢 ${String(event.title ?? 'Event').slice(0, 70)} · check-in & reminders`, message, 'event');
    const threadId = typeof made === 'string' ? made : made.threadId;
    if (typeof made === 'string') await this.io.post(message, threadId);
    map[event.id] = threadId;
    await this.store.setMeta('eventPingThreads', map);
  }

  async syncNow() {
    const now = this.now();
    const events = (await this.site.query('events', 'published', true))
      .map((d) => ({ id: d.id, ...d.data }))
      .filter((e) => e.status === 'upcoming' && e.date && !e.timeTbd && e.date - 25 * 3600e3 < now && now < e.date + 3600e3);
    if (!events.length) return 0;
    const [teams, players] = await Promise.all([this.site.list('teams'), this.site.list('players')]);
    const teamMap = new Map(teams.map((d) => [d.id, d.data]));
    const playerMap = new Map(players.map((d) => [d.id, d.data]));
    const ctxs = [];
    for (const e of events) {
      const [entries, rosters, checkins] = await Promise.all([
        this.site.list(`events/${e.id}/entries`),
        this.site.list(`events/${e.id}/rosters`),
        this.site.list(`events/${e.id}/checkins`),
      ]);
      const teamIds = [...new Set([...(e.teamIds ?? []), ...entries.map((x) => x.data.teamId ?? x.id)])]
        .filter((id) => teamMap.has(id) && teamMap.get(id).status !== 'disbanded');
      ctxs.push({
        event: e, teamIds, teams: teamMap, players: playerMap,
        rosters: Object.fromEntries(rosters.map((r) => [r.id, r.data])),
        checkins: checkins.map((c) => ({ playerId: c.data.playerId ?? c.id })),
      });
    }
    const sentMap = { ...(this.store.getMeta('eventPings') ?? {}) };
    const due = planPings({ events: ctxs, now, sent: new Set(Object.keys(sentMap)), siteUrl: this.config.siteUrl });
    let posted = 0;
    for (const p of due) {
      if (p.content) {
        const event = ctxs.find((c) => c.event.id === p.eventId)?.event ?? { id: p.eventId, title: 'Event' };
        for (const part of chunks(p.content)) {
          const ids = p.userIds.filter((id) => part.includes(`<@${id}>`)).slice(0, 100);
          await this.postFor(event, { content: part, allowedMentions: { users: ids } });
        }
        posted++;
        this.log.info?.(`[event pings] ${p.kind} for ${p.eventId}: ${p.userIds.length} pinged`);
      }
      sentMap[p.key] = now;
    }
    // Forget stages older than a week.
    for (const [k, at] of Object.entries(sentMap)) if (now - at > 7 * 86400e3) delete sentMap[k];
    if (due.length) await this.store.setMeta('eventPings', sentMap);
    return posted;
  }
}
