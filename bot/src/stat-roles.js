// Stat roles (STAT_ROLES=1, needs Manage Roles): "👑 Point Machine · Top 3 ✨" and one for every other stat
// (logic/stat-roles.js STAT_ROLE_STYLE: emoji flair, colour, gradient + role icon where the server allows),
// always held by the current top 3 (ties included) across every published event, and taken off
// whoever drops out. Every STAT_ROLES_MINUTES (30) the bot reads the results from the site (public
// data, no sign-in), works out the top 3s (logic/stat-roles.js) and moves the roles.
//
// Remembered in the store's meta: statRoles = { statKey: roleId } (roles it made) and
// statRoleHolders = { statKey: [discordIds] } (who had each last time, so it knows whom to take
// them from). It never touches any other role.
// roleIo: the same as club roles (discord-io.js).
import { STAT_ROLE_STATS, STAT_ROLE_LOOK, statRoleName, statRoleStyle, statTotals, wantedHolders, planHolders } from './logic/stat-roles.js';

export class StatRoles {
  constructor({ io, site, store, config, log = console }) {
    Object.assign(this, { io, site, store, config, log });
    this.chain = Promise.resolve();
  }

  start() {
    this.timer = setInterval(() => this.sync().catch(() => {}), this.config.statRolesMinutes * 60 * 1000);
    this.timer.unref?.();
    return this.sync();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  sync() {
    const run = this.chain.then(() => this.syncNow());
    this.chain = run.catch((err) => this.log.error('[stat roles]', err.message));
    return run;
  }

  async syncNow() {
    // Every published event's results, and every player (for their Discord ID).
    const events = await this.site.query('events', 'published', true);
    const results = [];
    for (const e of events) for (const r of await this.site.list(`events/${e.id}/results`)) results.push(r.data);
    const players = new Map((await this.site.list('players')).map((d) => [d.id, d.data]));
    const top = this.config.statRolesTop;
    const want = wantedHolders(statTotals(results), players, top);

    // Make sure each role exists (and has the right name).
    const roleMap = { ...(this.store.getMeta('statRoles') ?? {}) };
    const existing = await this.io.roles();
    // Gradient colours and role icons only where the server has them (boosts).
    const features = new Set((await this.io.features?.().catch(() => [])) ?? []);
    const look = (stat) => {
      const s = statRoleStyle(stat);
      return {
        name: statRoleName(stat, top), color: s.color, hoist: false,
        ...(features.has('ENHANCED_ROLE_COLORS') ? { color2: s.color2 } : {}),
        ...(features.has('ROLE_ICONS') ? { emoji: s.emoji } : {}),
      };
    };
    const restyle = (this.store.getMeta('statRoleLook') ?? 0) !== STAT_ROLE_LOOK;
    let made = 0;
    for (const stat of STAT_ROLE_STATS) {
      const id = roleMap[stat.key];
      if (id && existing.has(id)) {
        if (restyle || existing.get(id).name !== statRoleName(stat, top)) await this.io.editRole(id, look(stat)).catch((err) => this.log.warn('[stat roles]', err.message));
        continue;
      }
      roleMap[stat.key] = await this.io.createRole(look(stat));
      made++;
    }
    if (made) await this.store.setMeta('statRoles', roleMap);
    if (restyle) {
      await this.store.setMeta('statRoleLook', STAT_ROLE_LOOK);
      this.log.info?.(`[stat roles] new look${features.has('ENHANCED_ROLE_COLORS') ? ' with gradients' : ''}${features.has('ROLE_ICONS') ? ' and role icons' : ''}`);
    }

    // A role made just now has nobody yet, whatever was saved before.
    const before = { ...(this.store.getMeta('statRoleHolders') ?? {}) };
    for (const stat of STAT_ROLE_STATS) if (!existing.has(roleMap[stat.key])) before[stat.key] = [];
    const plan = planHolders({ before, want });
    let added = 0;
    let removed = 0;
    const holders = Object.fromEntries([...want].map(([k, ids]) => [k, [...ids]]));
    for (const { key, userId } of plan.remove) {
      try {
        await this.io.removeRole(userId, roleMap[key]);
        removed++;
      } catch (err) {
        if (!/Unknown (Member|User)/i.test(err.message)) this.log.warn('[stat roles]', err.message);
      }
    }
    for (const { key, userId } of plan.add) {
      try {
        await this.io.addRole(userId, roleMap[key]);
        added++;
      } catch (err) {
        // Not in the server (yet): try again next time.
        holders[key] = holders[key].filter((id) => id !== userId);
        if (!/Unknown (Member|User)/i.test(err.message)) this.log.warn('[stat roles]', err.message);
      }
    }
    if (JSON.stringify(holders) !== JSON.stringify(this.store.getMeta('statRoleHolders') ?? {})) await this.store.setMeta('statRoleHolders', holders);
    if (made || added || removed) this.log.info?.(`[stat roles] ${made} roles made, ${added} given, ${removed} taken away`);
    return { made, added, removed };
  }
}
