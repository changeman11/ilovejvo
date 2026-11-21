// Event Player role (added 2026-11-21, EVENT_ROLE=0 turns it off): "🎟️ Event Player" goes to every
// player taking part in an upcoming or running event (not pre-launch): everyone in a club that's
// in it (signed up or added by admins), anyone on its event roster (mix teams, subs) and solo
// sign-ups. It comes off once they're in no such event (the event finished or was cancelled, or
// they left / pulled out). Staff can @mention it. Every EVENT_ROLE_MINUTES (5).
// Remembered in the store's meta: eventRole = roleId, eventRoleHolders = [discordIds].
//
// io: roleIo (roles, createRole, addRole, removeRole). site: SiteReader.
import { isPreLaunch } from './site-rules/eras.js';

export const EVENT_ROLE = '🎟️ Event Player';
const isId = (id) => /^\d{15,22}$/.test(String(id ?? ''));

// Pure: the Discord IDs who should hold the role.
// events: [{ event, teamIds, rosters: { teamId: { playerIds } }, soloIds: [playerId] }]
// teams: Map teamId -> team, players: Map playerId -> player. now: ms.
export function eventPlayerIds({ events, teams, players, now }) {
  const want = new Set();
  const add = (pid) => { const id = players.get(pid)?.discordId; if (isId(id)) want.add(String(id)); };
  for (const { event: e, teamIds, rosters, soloIds } of events) {
    if (e.published === false || e.status !== 'upcoming' || isPreLaunch(e)) continue;
    // A running event keeps the role for up to 12 hours after its start.
    if (e.date && !e.timeTbd && now > e.date + 12 * 3600e3) continue;
    for (const teamId of teamIds) {
      const team = teams.get(teamId);
      if (!team || team.status === 'disbanded') continue;
      for (const pid of rosters[teamId]?.playerIds ?? []) add(pid);
      if (!team.mix) for (const [pid, p] of players) if (p.teamId === teamId) add(pid);
    }
    for (const pid of soloIds ?? []) add(pid);
  }
  return want;
}

export class EventRole {
  constructor({ io, site, store, config, log = console, now = () => Date.now() }) {
    Object.assign(this, { io, site, store, config, log, now });
    this.chain = Promise.resolve();
  }

  start() {
    this.timer = setInterval(() => this.sync(), (this.config.eventRoleMinutes ?? 5) * 60 * 1000);
    this.timer.unref?.();
    return this.sync();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  sync() {
    const run = this.chain.then(() => this.syncNow());
    this.chain = run.catch((err) => this.log.warn('[event role]', err.message));
    return run;
  }

  async syncNow() {
    const evs = (await this.site.query('events', 'published', true)).map((d) => ({ id: d.id, ...d.data }))
      .filter((e) => e.status === 'upcoming' && !isPreLaunch(e));
    const events = [];
    let teams = new Map();
    let players = new Map();
    if (evs.length) {
      const [t, p] = await Promise.all([this.site.list('teams'), this.site.list('players')]);
      teams = new Map(t.map((d) => [d.id, d.data]));
      players = new Map(p.map((d) => [d.id, d.data]));
      for (const e of evs) {
        const [entries, rosters, solos] = await Promise.all([
          this.site.list(`events/${e.id}/entries`), this.site.list(`events/${e.id}/rosters`), this.site.list(`events/${e.id}/solos`),
        ]);
        events.push({
          event: e,
          teamIds: [...new Set([...(e.teamIds ?? []), ...entries.map((x) => x.data.teamId ?? x.id)])],
          rosters: Object.fromEntries(rosters.map((r) => [r.id, r.data])),
          soloIds: solos.map((x) => x.data.playerId ?? x.id),
        });
      }
    }
    const want = eventPlayerIds({ events, teams, players, now: this.now() });

    const existing = await this.io.roles();
    let roleId = this.store.getMeta('eventRole') ?? null;
    if (roleId && !existing.has(roleId)) roleId = null;
    if (!roleId) {
      roleId = await this.io.createRole({ name: EVENT_ROLE, color: 0, hoist: false, mentionable: true });
      await this.store.setMeta('eventRole', roleId);
      await this.store.setMeta('eventRoleHolders', []);
    }
    const had = new Set(this.store.getMeta('eventRoleHolders') ?? []);
    const now = new Set();
    let added = 0;
    let removed = 0;
    for (const id of had) {
      if (want.has(id)) { now.add(id); continue; }
      try { await this.io.removeRole(id, roleId); removed++; } catch (err) { if (!/Unknown (Member|User)/i.test(err.message)) { now.add(id); this.log.warn('[event role]', err.message); } }
    }
    for (const id of want) {
      if (had.has(id)) continue;
      try { await this.io.addRole(id, roleId); now.add(id); added++; } catch (err) { if (!/Unknown (Member|User)/i.test(err.message)) this.log.warn('[event role]', err.message); }
    }
    const list = [...now].sort();
    if (JSON.stringify(list) !== JSON.stringify([...had].sort())) await this.store.setMeta('eventRoleHolders', list);
    if (added || removed) this.log.info?.(`[event role] ${EVENT_ROLE}: ${added} given, ${removed} taken off`);
    return { added, removed };
  }
}
