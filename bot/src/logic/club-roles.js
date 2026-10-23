// Club roles: a cosmetic Discord role per I<3JVO club, given to the club's players.
// Pure planning only: what roles to make, change or delete, and who gains or loses one.
// Players are matched to Discord by the `discordId` on their site profile.

// Clubs that get a role: approved (or no status, like older clubs), and not one-event mix teams.
export function eligibleClubs(teams) {
  const clubs = new Map();
  for (const [id, t] of teams) {
    if (!t || t.mix) continue;
    if ((t.status ?? 'approved') !== 'approved') continue;
    const name = String(t.name ?? '').trim();
    if (!name) continue;
    clubs.set(id, { name: name.slice(0, 100), color: colorNumber(t.colors?.primary) });
  }
  return clubs;
}

// '#1438d8' -> 0x1438d8. Anything else -> 0 (no colour).
export function colorNumber(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  return m ? parseInt(m[1], 16) : 0;
}

// roleMap: { teamId: roleId } for roles the bot made. existing: Map roleId -> { name, color, hoist }.
//   -> { create: [teamId], update: [{ teamId, roleId, name, color }], remove: [{ teamId, roleId }] }
export function planRoles({ clubs, roleMap, existing, hoist = true }) {
  const create = [];
  const update = [];
  const remove = [];
  for (const [teamId, club] of clubs) {
    const roleId = roleMap[teamId];
    const role = roleId ? existing.get(roleId) : null;
    if (!role) create.push(teamId);
    else if (role.name !== club.name || role.color !== club.color || role.hoist !== hoist) update.push({ teamId, roleId, ...club });
  }
  for (const [teamId, roleId] of Object.entries(roleMap)) {
    if (!clubs.has(teamId) && existing.has(roleId)) remove.push({ teamId, roleId });
  }
  return { create, update, remove };
}

// Which club each Discord user should have (or null). players: [{ discordId, teamId }].
export function wantedClub(players, clubs) {
  const want = new Map();
  for (const p of players) {
    const id = String(p.discordId ?? '').trim();
    if (!/^\d{15,22}$/.test(id)) continue;
    const club = p.teamId && clubs.has(p.teamId) ? p.teamId : null;
    if (!want.has(id) || (club && !want.get(id))) want.set(id, club);
  }
  return want;
}

// memberRoles: Map discordId -> Set(roleIds), or null when they aren't in the Discord server.
//   -> { add: [{ userId, roleId }], remove: [{ userId, roleId }] }
export function planMembers({ want, roleMap, memberRoles }) {
  const managed = new Set(Object.values(roleMap));
  const add = [];
  const remove = [];
  for (const [userId, roles] of memberRoles) {
    if (!roles) continue;
    const teamId = want.get(userId) ?? null;
    const target = teamId ? roleMap[teamId] ?? null : null;
    for (const r of roles) if (managed.has(r) && r !== target) remove.push({ userId, roleId: r });
    if (target && !roles.has(target)) add.push({ userId, roleId: target });
  }
  return { add, remove };
}
