// Event keeper (added 2026-11-28, EVENT_KEEPER=0 turns it off): the timed jobs an admin's browser used
// to do (public/js/admin-sync.js), done by the bot so an event runs with nobody online:
// - at the lock (5 minutes before the start) it saves the round robin worked out from the sign-ups,
//   and later the finals once both teams are known (site-rules/autofix.js schedulePlan)
// - after the group stage it saves when the finals open (site-rules/flow.js finalsOpenToSave)
// It checks every minute, only for events within 20 minutes of their start or running (12 hours).
// firestore.rules lets the bot create auto-/finals- fixtures and change only fixturesLockedAt,
// groups and flow on a published upcoming event.
//
// site: SiteReader. rest: the bot's FirestoreRest.
import { schedulePlan, drawToSave } from './site-rules/autofix.js';
import { finalsOpenToSave } from './site-rules/flow.js';
import { seasonOf } from './site-rules/award-event.js';

const MIN = 60000;
export const keeperDue = (event, now) => event.published !== false && (event.status ?? 'upcoming') === 'upcoming'
  && event.date && !event.timeTbd && now >= event.date - 20 * MIN && now <= event.date + 12 * 60 * MIN;

// What the site's admin-data.js storedFixture() keeps.
function storedFixture(f) {
  const { id: _id, round: _round, virtual: _v, homePlaceholder: _hp, awayPlaceholder: _ap, ...data } = f;
  return data;
}

export class EventKeeper {
  constructor({ site, rest, log = console, now = () => Date.now() }) {
    Object.assign(this, { site, rest, log, now });
    this.chain = Promise.resolve();
  }

  start() {
    this.timer = setInterval(() => this.sync(), MIN);
    this.timer.unref?.();
    return this.sync();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  sync() {
    const run = this.chain.then(() => this.syncNow());
    this.chain = run.catch((err) => this.log.warn('[event keeper]', err.message));
    return run;
  }

  async bundle(event) {
    const list = (sub) => this.site.list(`events/${event.id}/${sub}`).then((xs) => xs.map((x) => ({ id: x.id, ...x.data }))).catch(() => []);
    const [fixtures, results, entries, submissions, checkins, rosters] = await Promise.all(
      ['fixtures', 'results', 'entries', 'submissions', 'checkins', 'rosters'].map(list));
    const season = seasonOf(event);
    const resultsById = Object.fromEntries(results.map((r) => [r.id, r]));
    const saved = fixtures.map((f) => ({ ...f, round: f.order ?? 0 }));
    const plan = schedulePlan({ event, season, entries, fixtures: saved, results: resultsById, now: this.now() });
    return {
      event, season, plan, entries, submissions, checkins,
      rosters: Object.fromEntries(rosters.map((r) => [r.id, r])),
      fixtures: [...saved, ...plan.virtual.map((f) => ({ ...f, round: f.order ?? 0 }))],
      results: resultsById,
    };
  }

  async syncNow() {
    const now = this.now();
    const events = (await this.site.query('events', 'published', true)).map((d) => ({ id: d.id, ...d.data }))
      .filter((e) => keeperDue(e, now));
    let done = 0;
    for (const event of events) {
      const b = await this.bundle(event);
      await this.rest.token();
      const uid = this.rest.uid;
      const { toSave, lockGroup } = b.plan;
      if (toSave.length) {
        const writes = toSave.map((f) => ({
          path: `events/${event.id}/fixtures/${f.id}`,
          data: { ...storedFixture(f), updatedBy: uid },
          serverTime: ['updatedAt'],
          mustNotExist: true,
        }));
        if (lockGroup && !event.fixturesLockedAt) {
          const draw = drawToSave(b.plan);
          const data = { updatedBy: uid, ...(draw ? { groups: { ...(event.groups ?? {}), assign: draw } } : {}) };
          writes.push({ path: `events/${event.id}`, data, mask: ['updatedBy', ...(draw ? ['groups'] : [])], serverTime: ['updatedAt', 'fixturesLockedAt'] });
        }
        writes.push({ path: `auditLog/${now.toString(36)}${Math.random().toString(36).slice(2, 12)}`, data: { by: uid, action: 'update', path: `events/${event.id}`, before: null, after: { fixturesSaved: toSave.map((f) => f.id), lock: Boolean(lockGroup) } }, serverTime: ['at'] });
        try {
          await this.rest.commit(writes);
          done += toSave.length;
          this.log.info?.(`[event keeper] ${event.title}: saved ${toSave.length} fixtures${lockGroup ? ' (locked)' : ''}`);
        } catch (err) {
          this.log.warn('[event keeper] saving fixtures for', event.title, err.message);
        }
        continue; // the finals time is checked next minute, on fresh data
      }
      const opensAt = finalsOpenToSave(b, now);
      if (opensAt) {
        try {
          await this.rest.commit([
            { path: `events/${event.id}`, data: { flow: { ...(event.flow ?? {}), finalsOpenAt: opensAt }, updatedBy: uid }, mask: ['flow', 'updatedBy'], serverTime: ['updatedAt'] },
            { path: `auditLog/${now.toString(36)}${Math.random().toString(36).slice(2, 12)}`, data: { by: uid, action: 'update', path: `events/${event.id}`, before: null, after: { finalsOpenAt: opensAt } }, serverTime: ['at'] },
          ]);
          done++;
          this.log.info?.(`[event keeper] ${event.title}: finals open at ${new Date(opensAt).toISOString()}`);
        } catch (err) {
          this.log.warn('[event keeper] finals time for', event.title, err.message);
        }
      }
    }
    return done;
  }
}
