// Role layout (added 2026-11-21): how the bot's roles are ordered and split into sections on a
// member's profile. Pure planning only (tested).
//
// Under the bot's own role, top to bottom:
//   ━━━━━ TEAM ━━━━━      (divider)  then every club role, then Captain
//   ━━━━ AWARDS ━━━━      (divider)  then the award roles: every 1st, every 2nd, every 3rd
//   …every other role, in the order it was already in.
// Club roles come first so a name shows the club colour (award roles have none).
// A divider is given to everyone holding a role in its section, and taken off when they don't.

export const DIVIDERS = {
  team: '━━━━━━ TEAM ━━━━━━',
  awards: '━━━━━ AWARDS ━━━━━',
};

// The wanted order of the managed blocks (first = highest). Missing ids are skipped.
export function layoutOrder({ teamDivider, clubIds = [], captainId, awardsDivider, awardIds = [] }) {
  return [teamDivider, ...clubIds, captainId, awardsDivider, ...awardIds].filter(Boolean);
}

// True when the order isn't one block directly under the bot's role.
// roles: Map roleId -> { position }.
export function needsOrdering(roles, order, botTop) {
  const ids = order.filter((id) => roles.has(id));
  if (!ids.length || botTop == null) return false;
  return ids.some((id, i) => roles.get(id).position !== botTop - 1 - i);
}

// Who should hold each divider. members: [{ id, roles: Set }].
// -> { add: [{ userId, roleId }], remove: [{ userId, roleId }] }
export function planDividers({ members, sections }) {
  const add = [];
  const remove = [];
  for (const { dividerId, roleIds } of sections) {
    if (!dividerId) continue;
    const inSection = new Set(roleIds);
    for (const m of members) {
      const wants = [...m.roles].some((r) => inSection.has(r));
      const has = m.roles.has(dividerId);
      if (wants && !has) add.push({ userId: m.id, roleId: dividerId });
      else if (!wants && has) remove.push({ userId: m.id, roleId: dividerId });
    }
  }
  return { add, remove };
}
