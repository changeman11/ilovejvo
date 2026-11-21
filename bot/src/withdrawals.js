// Withdrawn clubs (added 2026-11-21, AUTO_FORFEITS=0 turns it off): when a club in an event whose
// fixtures are locked is disbanded, or taken out of an event with automatic fixtures, its matches
// there that have no result are recorded as forfeits: the other team wins 2–0 (10–0 sets), no
// player stats (like an admin's forfeit). Played results stay. Checks every 2 minutes.
// firestore.rules lets the bot write exactly this, and only for a withdrawn club.
//
// site: SiteReader. rest: the bot's FirestoreRest.
import { forfeitSets } from './site-rules/results.js';
import { formatFor } from './site-rules/season.js';
import { seasonOf } from './site-rules/award-event.js';

// Pure: which fixtures to forfeit. -> [{ fixture, teamId (the withdrawn one) }]
// event, fixtures [{ id, homeTeamId, awayTeamId, virtual }], results {id: result}, entryIds [teamId],
// teams Map teamId -> team.
export function forfeitsDue({ event, fixtures, results, entryIds, teams }) {
  if (event.published === false || event.status !== 'upcoming' || !event.fixturesLockedAt) return [];
  const inEvent = new Set([...(event.teamIds ?? []), ...entryIds]);
  const auto = (event.autoFixtures ?? 'off') !== 'off';
  const gone = (id) => {
    const t = teams.get(id);
    if (!t) return false;
    if (t.status === 'disbanded') return true;
    return auto && !t.mix && !inEvent.has(id);
  };
  const out = [];
  for (const f of fixtures) {
    if (f.virtual || !f.homeTeamId || !f.awayTeamId || results[f.id]) continue;
    const h = gone(f.homeTeamId);
    const a = gone(f.awayTeamId);
    if (h === a) continue; // neither (normal), or both gone (an admin decides)
    out.push({ fixture: f, teamId: h ? f.homeTeamId : f.awayTeamId });
  }
  return out;
}

export class Withdrawals {
  constructor({ site, rest, config, log = console, now = () => Date.now() }) {
    Object.assign(this, { site, rest, config, log, now });
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
    this.chain = run.catch((err) => this.log.warn('[forfeits]', err.message));
    return run;
  }

  async syncNow() {
    const events = (await this.site.query('events', 'published', true)).map((d) => ({ id: d.id, ...d.data }))
      .filter((e) => e.status === 'upcoming' && e.fixturesLockedAt);
    if (!events.length) return 0;
    const teams = new Map((await this.site.list('teams')).map((d) => [d.id, d.data]));
    let made = 0;
    for (const event of events) {
      const [fx, rs, entries] = await Promise.all([
        this.site.list(`events/${event.id}/fixtures`), this.site.list(`events/${event.id}/results`), this.site.list(`events/${event.id}/entries`),
      ]);
      const fixtures = fx.map((x) => ({ id: x.id, ...x.data }));
      const results = Object.fromEntries(rs.map((r) => [r.id, r.data]));
      const due = forfeitsDue({ event, fixtures, results, entryIds: entries.map((x) => x.data.teamId ?? x.id), teams });
      if (!due.length) continue;
      await this.rest.token();
      const uid = this.rest.uid;
      const season = seasonOf(event);
      for (const { fixture, teamId } of due) {
        const path = `events/${event.id}/results/${fixture.id}`;
        const result = {
          sets: forfeitSets(formatFor(season, fixture), teamId === fixture.homeTeamId ? 'away' : 'home'),
          playerStats: {}, mvpPlayerId: null, forfeit: { teamId }, autoForfeit: true, enteredBy: uid, updatedBy: uid,
        };
        try {
          await this.rest.commit([
            { path, data: result, serverTime: ['enteredAt', 'updatedAt'], mustNotExist: true },
            { path: `auditLog/${this.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`, data: { by: uid, action: 'create', path, before: null, after: { forfeit: { teamId }, autoForfeit: true } }, serverTime: ['at'] },
          ]);
          made++;
          this.log.info?.(`[forfeits] ${teams.get(teamId)?.name ?? teamId} forfeits ${fixture.id} (${event.title})`);
        } catch (err) {
          this.log.warn('[forfeits]', fixture.id, err.message);
        }
      }
    }
    return made;
  }
}
