// Stat roles (STAT_ROLES=1, needs Manage Roles): "🥇 1st · Point Machine 👑", "🥈 2nd · …", "🥉 3rd · …"
// for every stat (logic/stat-roles.js STAT_ROLE_STYLE: emoji flair, colour, gradient + role icon where
// the server allows). Each is held by whoever is in that place right now across every published
// event (ties share a place) and taken off whoever moves. Every STAT_ROLES_MINUTES (30) the bot reads
// the results from the site (public data, no sign-in), works out the places and moves the roles.
//
// Remembered in the store's meta: statRoles = { "statKey:place": roleId } (roles it made) and
// statRoleHolders = { "statKey:place": [discordIds] } (who had each last time, so it knows whom to
// take them from). Before 2026-10-25 the keys were just "statKey" (one Top 3 role): that role becomes
// the 1st place one, renamed. It never touches any other role.
// roleIo: the same as club roles (discord-io.js).
import { STAT_ROLE_STATS, STAT_ROLE_LOOK, PLACE_MEDAL, statRoleName, statRoleStyle, roleKey, statTotals, wantedHolders, planHolders } from './logic/stat-roles.js';

// Old single-role keys ("pts") move to the 1st place key ("pts:1").
const upgradeKeys = (map) => Object.fromEntries(Object.entries(map ?? {}).map(([k, v]) => [k.includes(':') ? k : roleKey(k, 1), v]));

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
    const savedMap = this.store.getMeta('statRoles') ?? {};
    const roleMap = upgradeKeys(savedMap);
    const upgraded = JSON.stringify(roleMap) !== JSON.stringify(savedMap);
    const existing = await this.io.roles();
    // Gradient colours and role icons only where the server has them (boosts).
    const features = new Set((await this.io.features?.().catch(() => [])) ?? []);
    const look = (stat, place) => {
      const s = statRoleStyle(stat);
      return {
        name: statRoleName(stat, place), color: s.color, hoist: false,
        ...(features.has('ENHANCED_ROLE_COLORS') ? { color2: s.color2 } : {}),
        // Role icon: the stat's own emoji for 1st, the medal for 2nd and 3rd.
        ...(features.has('ROLE_ICONS') ? { emoji: place === 1 ? s.emoji : PLACE_MEDAL[place - 1] ?? s.emoji } : {}),
      };
    };
    const restyle = (this.store.getMeta('statRoleLook') ?? 0) !== STAT_ROLE_LOOK;
    let made = 0;
    // New roles go just under the bot's own, so making 3rd, then 2nd, then 1st keeps 1st on top.
    for (const stat of STAT_ROLE_STATS) {
      for (let place = top; place >= 1; place--) {
        const key = roleKey(stat.key, place);
        const id = roleMap[key];
        if (id && existing.has(id)) {
          if (restyle || existing.get(id).name !== statRoleName(stat, place)) await this.io.editRole(id, look(stat, place)).catch((err) => this.log.warn('[stat roles]', err.message));
          continue;
        }
        roleMap[key] = await this.io.createRole(look(stat, place));
        made++;
      }
    }
    if (made || upgraded) await this.store.setMeta('statRoles', roleMap);
    // Every 1st above every 2nd above every 3rd, so a member's name colour comes from their best place.
    if ((made || upgraded || restyle) && this.io.orderRoles) {
      const order = [];
      for (let place = 1; place <= top; place++) for (const stat of STAT_ROLE_STATS) order.push(roleMap[roleKey(stat.key, place)]);
      await this.io.orderRoles(order).catch((err) => this.log.warn('[stat roles] couldn’t order the roles:', err.message));
    }
    if (restyle) {
      await this.store.setMeta('statRoleLook', STAT_ROLE_LOOK);
      this.log.info?.(`[stat roles] new look${features.has('ENHANCED_ROLE_COLORS') ? ' with gradients' : ''}${features.has('ROLE_ICONS') ? ' and role icons' : ''}`);
    }

    // A role made just now has nobody yet, whatever was saved before.
    const before = upgradeKeys(this.store.getMeta('statRoleHolders'));
    for (const key of Object.keys(roleMap)) if (!existing.has(roleMap[key])) before[key] = [];
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
