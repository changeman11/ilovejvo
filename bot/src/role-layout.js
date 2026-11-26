// Role layout (added 2026-11-21, ROLE_LAYOUT=0 turns it off): keeps the bot's roles in one fixed
// order under its own role, with two divider roles (━━ TEAM ━━ and ━━ AWARDS ━━) that split a
// member's roles into sections on their profile. See logic/role-layout.js for the order.
// Every ROLE_LAYOUT_MINUTES (5) and at start (after the club and award roles have had a moment).
// The dividers it made are remembered as dividerRoles = { team, awards } in the store's meta; it
// reads clubRoles, captainRole and statRoles (made by club-roles.js / stat-roles.js).
//
// io (roleIo in discord-io.js): roles(), createRole(), editRole(), positions(), raiseRoles(ids),
//   allMembers() -> [{ id, roles: Set }] | null, addRole(userId, roleId), removeRole(userId, roleId)
import { DIVIDERS, layoutOrder, needsOrdering, planDividers } from './logic/role-layout.js';
import { STAT_ROLE_STATS, roleKey } from './logic/stat-roles.js';

export class RoleLayout {
  constructor({ io, store, config, log = console }) {
    Object.assign(this, { io, store, config, log });
    this.chain = Promise.resolve();
  }

  start(delayMs = 90 * 1000) {
    this.timer = setInterval(() => this.sync(), (this.config.roleLayoutMinutes ?? 5) * 60 * 1000);
    this.timer.unref?.();
    this.first = setTimeout(() => this.sync(), delayMs);
    this.first.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.first) clearTimeout(this.first);
  }

  sync() {
    const run = this.chain.then(() => this.syncNow());
    this.chain = run.catch((err) => this.log.warn('[role layout]', err.message));
    return run;
  }

  async syncNow() {
    const existing = await this.io.roles();
    // 1. The two dividers exist (no colour, not shown separately).
    const dividers = { ...(this.store.getMeta('dividerRoles') ?? {}) };
    let made = 0;
    for (const [key, name] of Object.entries(DIVIDERS)) {
      const id = dividers[key];
      if (id && existing.has(id)) {
        if (existing.get(id).name !== name) await this.io.editRole(id, { name, color: 0, hoist: false });
        continue;
      }
      dividers[key] = await this.io.createRole({ name, color: 0, hoist: false });
      made++;
    }
    if (made) await this.store.setMeta('dividerRoles', dividers);

    // 2. One fixed order under the bot.
    const clubIds = Object.values(this.store.getMeta('clubRoles') ?? {});
    const statMap = this.store.getMeta('statRoles') ?? {};
    const awardIds = [];
    for (let place = 1; place <= 3; place++) for (const s of STAT_ROLE_STATS) if (statMap[roleKey(s.key, place)]) awardIds.push(statMap[roleKey(s.key, place)]);
    const captainId = this.store.getMeta('captainRole') ?? null;
    const eventRoleId = this.store.getMeta('eventRole') ?? null;
    // The 🏆 Pre-launch Champion role heads the AWARDS section.
    const championId = this.store.getMeta('championRole') ?? null;
    if (championId) awardIds.unshift(championId);
    // Event winner roles (stat-roles.js syncWinnerRoles) come next, before the stat awards.
    const winnerIds = Object.values(this.store.getMeta('winnerRoles') ?? {});
    awardIds.splice(championId ? 1 : 0, 0, ...winnerIds);
    const { roles, botTop } = await this.io.positions();
    // Clubs keep their current order among themselves.
    const clubsSorted = clubIds.filter((id) => roles.has(id)).sort((a, b) => roles.get(b).position - roles.get(a).position);
    const order = layoutOrder({ teamDivider: dividers.team, clubIds: clubsSorted, captainId, eventRoleId, awardsDivider: dividers.awards, awardIds });
    let moved = false;
    if (needsOrdering(roles, order, botTop)) {
      await this.io.raiseRoles(order);
      moved = true;
    }

    // 3. Dividers on whoever has a role in their section.
    const members = await this.io.allMembers();
    let added = 0;
    let removed = 0;
    if (members) {
      const plan = planDividers({
        members,
        sections: [
          { dividerId: dividers.team, roleIds: [...clubIds, captainId, eventRoleId].filter(Boolean) },
          { dividerId: dividers.awards, roleIds: awardIds },
        ],
      });
      for (const { userId, roleId } of plan.remove) await this.io.removeRole(userId, roleId).then(() => removed++, (err) => this.log.warn('[role layout]', err.message));
      for (const { userId, roleId } of plan.add) await this.io.addRole(userId, roleId).then(() => added++, (err) => this.log.warn('[role layout]', err.message));
    }
    if (made || moved || added || removed) this.log.info?.(`[role layout] ${made} dividers made${moved ? ', roles re-ordered' : ''}; dividers given ${added}, taken ${removed}`);
    return { made, moved, added, removed };
  }
}
