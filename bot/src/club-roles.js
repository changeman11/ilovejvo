// Club roles: keeps a cosmetic Discord role per I<3JVO club, coloured in the club's colour and
// shown as its own group in the member list, on every club player whose site profile has their
// Discord ID. Clubs and players are read from the site (public data, no sign-in).
//
// Every CLUB_ROLES_MINUTES it reads only what changed since last time; every 6 hours (and at
// start and on /pickup syncroles) it reads everything. The roles it made are remembered in the
// store's meta as clubRoles = { teamId: roleId }, so it never touches roles it didn't make.
//
// roleIo (Discord side, see discord-io.js):
//   roles() -> Map roleId -> { name, color, hoist }      createRole({ name, color, hoist }) -> roleId
//   editRole(roleId, { name, color, hoist })               deleteRole(roleId)
//   memberRoles(userId) -> Set(roleIds), or null if they're not in the server
//   addRole(userId, roleId)                                removeRole(userId, roleId)
import { eligibleClubs, planRoles, wantedClub, planMembers, wantedCaptains, planCaptains } from './logic/club-roles.js';

const CAPTAIN_COLOR = 0xffe200; // the site's yellow

const FULL_EVERY = 6 * 60 * 60 * 1000;
const SKEW = 60 * 1000; // re-read a minute of overlap, in case clocks differ a little

export class ClubRoles {
  constructor({ io, site, store, config, log = console, now = () => Date.now() }) {
    Object.assign(this, { io, site, store, config, log, now });
    this.teams = new Map();
    this.players = new Map();
    this.lastRead = 0;
    this.lastFull = 0;
    this.chain = Promise.resolve();
    this.timer = null;
  }

  run(fn) {
    const result = this.chain.then(fn);
    this.chain = result.catch((err) => this.log.error('[club roles]', err.message));
    return result;
  }

  start() {
    const minutes = this.config.clubRolesMinutes;
    this.timer = setInterval(() => this.tick().catch(() => {}), minutes * 60 * 1000);
    return this.fullSync();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  tick() {
    return this.now() - this.lastFull > FULL_EVERY ? this.fullSync() : this.quickSync();
  }

  fullSync() {
    return this.run(async () => {
      const started = this.now();
      const [teams, players] = await Promise.all([this.site.list('teams'), this.site.list('players')]);
      this.teams = new Map(teams.map((d) => [d.id, d.data]));
      this.players = new Map(players.map((d) => [d.id, d.data]));
      this.lastRead = started;
      this.lastFull = started;
      const ids = [...this.players.values()].map((p) => String(p.discordId ?? '')).filter(Boolean);
      const result = await this.apply(ids);
      this.log.info?.(`[club roles] full check: ${describe(result)}`);
      return result;
    });
  }

  quickSync() {
    return this.run(async () => {
      const started = this.now();
      const since = this.lastRead - SKEW;
      const [teams, players] = await Promise.all([this.site.changedSince('teams', since), this.site.changedSince('players', since)]);
      this.lastRead = started;
      if (!teams.length && !players.length) return null;
      for (const d of teams) this.teams.set(d.id, d.data);
      const ids = new Set();
      for (const d of players) {
        const before = this.players.get(d.id);
        if (before?.discordId) ids.add(String(before.discordId));
        if (d.data.discordId) ids.add(String(d.data.discordId));
        this.players.set(d.id, d.data);
      }
      // A club that changed (approved, renamed, new colour) can change things for its players too.
      const changedTeams = new Set(teams.map((d) => d.id));
      for (const p of this.players.values()) if (changedTeams.has(p.teamId) && p.discordId) ids.add(String(p.discordId));
      const result = await this.apply([...ids]);
      if (result.created || result.updated || result.deleted || result.added || result.removed || result.errors) {
        this.log.info?.(`[club roles] ${describe(result)}`);
      }
      return result;
    });
  }

  // Bring roles in line with the site for these Discord users (and every club's role).
  async apply(discordIds) {
    const result = { created: 0, updated: 0, deleted: 0, added: 0, removed: 0, errors: 0, notInServer: 0 };
    const clubs = eligibleClubs(this.teams);
    const roleMap = { ...(this.store.getMeta('clubRoles') ?? {}) };
    const existing = await this.io.roles();
    for (const [teamId, roleId] of Object.entries(roleMap)) if (!existing.has(roleId)) delete roleMap[teamId];

    const plan = planRoles({ clubs, roleMap, existing, hoist: this.config.clubRolesHoist });
    const ids = new Set(discordIds);
    const attempt = async (fn) => {
      try {
        await fn();
        return true;
      } catch (err) {
        result.errors++;
        this.log.warn('[club roles]', err.message);
        return false;
      }
    };
    for (const { teamId, roleId } of plan.remove) {
      if (await attempt(() => this.io.deleteRole(roleId))) {
        delete roleMap[teamId];
        result.deleted++;
      }
    }
    for (const { roleId, name, color } of plan.update) {
      if (await attempt(() => this.io.editRole(roleId, { name, color, hoist: this.config.clubRolesHoist }))) result.updated++;
    }
    for (const teamId of plan.create) {
      const club = clubs.get(teamId);
      await attempt(async () => {
        roleMap[teamId] = await this.io.createRole({ name: club.name, color: club.color, hoist: this.config.clubRolesHoist });
        result.created++;
        // Everyone in a newly made club needs checking, even if their profile didn't change.
        for (const p of this.players.values()) if (p.teamId === teamId && p.discordId) ids.add(String(p.discordId));
      });
    }
    if (JSON.stringify(roleMap) !== JSON.stringify(this.store.getMeta('clubRoles') ?? {})) {
      await this.store.setMeta('clubRoles', roleMap);
    }

    const memberRoles = new Map();
    for (const id of ids) {
      if (!/^\d{15,22}$/.test(id)) continue;
      const roles = await this.io.memberRoles(id).catch(() => null);
      if (!roles) result.notInServer++;
      memberRoles.set(id, roles);
    }
    const want = wantedClub([...this.players.values()], clubs);
    const members = planMembers({ want, roleMap, memberRoles });
    for (const { userId, roleId } of members.remove) if (await attempt(() => this.io.removeRole(userId, roleId))) result.removed++;
    for (const { userId, roleId } of members.add) if (await attempt(() => this.io.addRole(userId, roleId))) result.added++;
    await this.applyCaptains({ clubs, existing, memberRoles, attempt, result });
    return result;
  }

  // The captain role (CAPTAIN_ROLE, default "Captain"): one role, given to every club's captain
  // (manager) and taken off anyone who isn't one any more. Remembered as captainRole = roleId.
  async applyCaptains({ clubs, existing, memberRoles, attempt, result }) {
    const name = this.config.captainRoleName;
    if (!name) return;
    let roleId = this.store.getMeta('captainRole') ?? null;
    if (roleId && !existing.has(roleId)) roleId = null;
    if (!roleId) {
      await attempt(async () => {
        roleId = await this.io.createRole({ name, color: CAPTAIN_COLOR, hoist: false });
        result.created++;
        await this.store.setMeta('captainRole', roleId);
      });
      if (!roleId) return;
      // A new role: everyone who's a captain needs it, not only those whose profile changed.
      for (const p of this.players.values()) {
        const id = String(p.discordId ?? '');
        if (/^\d{15,22}$/.test(id) && !memberRoles.has(id)) memberRoles.set(id, await this.io.memberRoles(id).catch(() => null));
      }
    } else if (existing.get(roleId).name !== name) {
      if (await attempt(() => this.io.editRole(roleId, { name, color: existing.get(roleId).color || CAPTAIN_COLOR, hoist: existing.get(roleId).hoist }))) result.updated++;
    }
    const players = [...this.players].map(([id, p]) => ({ ...p, id })); // (stored without their id)
    const plan = planCaptains({ want: wantedCaptains(players, this.teams, clubs), roleId, memberRoles });
    for (const userId of plan.remove) if (await attempt(() => this.io.removeRole(userId, roleId))) result.removed++;
    for (const userId of plan.add) if (await attempt(() => this.io.addRole(userId, roleId))) result.added++;
  }
}

export function describe(r) {
  if (!r) return 'nothing changed';
  return `${r.created} roles made, ${r.updated} updated, ${r.deleted} deleted; ${r.added} given, ${r.removed} taken away${r.errors ? `; ${r.errors} failed` : ''}`;
}
