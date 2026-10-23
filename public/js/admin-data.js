// Admin writes. Every change is saved together with an audit log entry (see writes.js).

import { commit as save, ts, newId, serverTimestamp } from './writes.js';
import { invalidate } from './data.js';
import { deleteImage } from './media.js';

// Admin saves always go through the admin (password) sign-in.
const commit = (uid, ops) => save(uid, ops, { admin: true });

// Readable ids from names ("Tasman Tide" -> "tasman-tide"), unique among `taken`.
export function slugId(name, taken) {
  const base = String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

// ---------- Events ----------

export async function saveEvent({ id, uid, event, existing }) {
  const eventId = id ?? newId('events');
  await commit(uid, [{
    type: 'set',
    path: `events/${eventId}`,
    before: existing,
    data: {
      ...event,
      date: ts(event.date),
      fixturesLockedAt: event.fixturesLockedAt ? ts(event.fixturesLockedAt) : null,
      createdAt: existing?.createdAt ? ts(existing.createdAt) : serverTimestamp(),
      createdBy: existing?.createdBy ?? uid,
    },
  }]);
  invalidate('event');
  return eventId;
}

// Deletes an event and everything inside it (fixtures, results, rosters).
export async function deleteEvent({ uid, bundle }) {
  const id = bundle.event.id;
  const ops = [
    ...bundle.fixtures.filter((f) => !f.virtual).map((f) => ({ type: 'delete', path: `events/${id}/fixtures/${f.id}`, before: f })),
    ...(bundle.entries ?? []).map((e) => ({ type: 'delete', path: `events/${id}/entries/${e.id}`, before: e })),
    ...Object.values(bundle.results).map((r) => ({ type: 'delete', path: `events/${id}/results/${r.id}`, before: r })),
    ...Object.values(bundle.rosters).map((r) => ({ type: 'delete', path: `events/${id}/rosters/${r.id}`, before: r })),
    { type: 'delete', path: `events/${id}`, before: bundle.event },
  ];
  await commit(uid, ops);
  invalidate('event');
}

// ---------- Site settings (FAQ, rules) ----------

export async function saveSetting({ uid, id, existing, data }) {
  await commit(uid, [{ type: 'set', path: `settings/${id}`, before: existing, data }]);
  invalidate(`setting:${id}`);
}

// ---------- Teams and players ----------

// joinPlayer: a player to put on this team in the same save (e.g. the manager when a team is approved).
export async function saveTeam({ id, uid, team, existing, joinPlayer = null }) {
  const ops = [{ type: 'set', path: `teams/${id}`, before: existing, data: team }];
  if (joinPlayer && joinPlayer.teamId !== id) {
    ops.push({ type: 'update', path: `players/${joinPlayer.id}`, before: joinPlayer, data: { teamId: id } });
  }
  await commit(uid, ops);
  invalidate();
}
export async function deleteTeam({ id, uid, existing }) {
  await commit(uid, [{ type: 'delete', path: `teams/${id}`, before: existing }]);
  invalidate();
}
export async function savePlayer({ id, uid, player, existing }) {
  await commit(uid, [{ type: 'set', path: `players/${id}`, before: existing, data: player }]);
  invalidate();
}
export async function deletePlayer({ id, uid, existing }) {
  await commit(uid, [{ type: 'delete', path: `players/${id}`, before: existing }]);
  invalidate();
}

// In-game names an admin matched to players from end-of-match screenshots (e.g. after a Steam
// name change). Stored on the player as `gameNames` so the next screenshot matches by itself.
export async function rememberGameNames({ uid, aliases, playersById }) {
  const byPlayer = new Map();
  for (const { playerId, name } of aliases) {
    if (!byPlayer.has(playerId)) byPlayer.set(playerId, new Set(playersById[playerId]?.gameNames ?? []));
    byPlayer.get(playerId).add(name);
  }
  const ops = [...byPlayer.entries()].map(([playerId, names]) => ({
    type: 'update',
    path: `players/${playerId}`,
    before: playersById[playerId],
    data: { gameNames: [...names].slice(-10) },
  }));
  if (ops.length) await commit(uid, ops);
  invalidate();
}

// ---------- Profile moderation ----------

// Takes down one uploaded image (logo, picture, banner or background) and deletes the file.
// owner: 'teams' | 'players'
export async function removeProfileImage({ uid, owner, doc, kind }) {
  const field = `${kind}Path`;
  const path = doc[field];
  await commit(uid, [{ type: 'update', path: `${owner}/${doc.id}`, before: doc, data: { [field]: null } }]);
  await deleteImage(path, { admin: true });
  invalidate();
}

// Clears a profile's tagline, bio and links (for anything unsuitable).
export async function clearProfileText({ uid, owner, doc }) {
  await commit(uid, [{ type: 'update', path: `${owner}/${doc.id}`, before: doc, data: { tagline: null, bio: '', socials: null } }]);
  invalidate();
}

// ---------- Inside an event ----------

export async function saveRoster({ eventId, teamId, uid, roster, existing }) {
  await commit(uid, [{ type: 'set', path: `events/${eventId}/rosters/${teamId}`, before: existing, data: roster }]);
  invalidate(`event:${eventId}`);
}

// A fixture as stored: without the fields pages add while showing it.
export function storedFixture(fixture) {
  const { id: _id, round: _round, virtual: _v, homePlaceholder: _hp, awayPlaceholder: _ap, ...data } = fixture;
  return data;
}

export async function saveFixture({ eventId, id, uid, fixture, existing }) {
  const fixtureId = id ?? newId(`events/${eventId}/fixtures`);
  await commit(uid, [{
    type: 'set',
    path: `events/${eventId}/fixtures/${fixtureId}`,
    before: existing?.virtual ? null : existing,
    data: { ...storedFixture(fixture), scheduledAt: ts(fixture.scheduledAt) },
  }]);
  invalidate(`event:${eventId}`);
  return fixtureId;
}

// "Clear fixtures": deletes the given fixtures (ones without a result), any result votes on them,
// and unlocks the schedule so the automatic fixtures are worked out again from the current teams.
export async function clearFixtures({ eventId, uid, fixtures, event, submissions = [] }) {
  const ids = new Set(fixtures.map((f) => f.id));
  const ops = [
    ...submissions.filter((s) => ids.has(s.fixtureId)).map((s) => ({ type: 'delete', path: `events/${eventId}/submissions/${s.id}`, before: s })),
    ...fixtures.map((f) => ({ type: 'delete', path: `events/${eventId}/fixtures/${f.id}`, before: f })),
  ];
  if (event.fixturesLockedAt) ops.push({ type: 'update', path: `events/${eventId}`, before: event, data: { fixturesLockedAt: null } });
  if (ops.length) await commit(uid, ops);
  invalidate(`event:${eventId}`);
}

// An admin signs a club up to an event (same record a manager would make).
export async function adminAddEntry({ eventId, uid, teamId }) {
  await commit(uid, [{ type: 'set', path: `events/${eventId}/entries/${teamId}`, data: { teamId, managerUid: uid, createdAt: serverTimestamp() } }]);
  invalidate(`event:${eventId}`);
}

// Takes a club that signed itself up out of an event.
export async function removeEntry({ eventId, uid, entry }) {
  await commit(uid, [{ type: 'delete', path: `events/${eventId}/entries/${entry.id}`, before: entry }]);
  invalidate(`event:${eventId}`);
}

// Saves the worked-out schedule (rules/autofix.js schedulePlan().toSave) with its own ids.
// lockGroup: also mark the round robin as fixed, so it stops following sign-ups.
// draw: { teamId: group letter } to save with the lock (so the groups can't change afterwards).
export async function saveSchedule({ eventId, uid, fixtures, lockGroup, event, draw = null }) {
  const ops = fixtures.map((f) => ({
    type: 'set',
    path: `events/${eventId}/fixtures/${f.id}`,
    data: { ...storedFixture(f), scheduledAt: ts(f.scheduledAt) },
  }));
  if (lockGroup && !event.fixturesLockedAt) {
    const data = { fixturesLockedAt: serverTimestamp() };
    if (draw) data.groups = { ...(event.groups ?? {}), assign: draw };
    ops.push({ type: 'update', path: `events/${eventId}`, before: event, data });
  }
  if (ops.length) await commit(uid, ops);
  invalidate(`event:${eventId}`);
}

// Several new fixtures in one save (auto-generated schedules).
export async function addFixtures({ eventId, uid, fixtures }) {
  await commit(uid, fixtures.map((fixture) => ({
    type: 'set',
    path: `events/${eventId}/fixtures/${newId(`events/${eventId}/fixtures`)}`,
    data: { ...fixture, scheduledAt: ts(fixture.scheduledAt) },
  })));
  invalidate(`event:${eventId}`);
}

// Deleting a fixture also deletes its result.
export async function deleteFixture({ eventId, uid, fixture, result }) {
  const ops = [{ type: 'delete', path: `events/${eventId}/fixtures/${fixture.id}`, before: fixture }];
  if (result) ops.unshift({ type: 'delete', path: `events/${eventId}/results/${fixture.id}`, before: result });
  await commit(uid, ops);
  invalidate(`event:${eventId}`);
}

// Saves a result and marks the fixture completed, together.
// swapTeams: { homeTeamId, awayTeamId } if the admin swapped home/away.
export async function saveResult({ eventId, fixture, uid, result, existing, swapTeams = null }) {
  const fixtureData = storedFixture(fixture);
  await commit(uid, [
    {
      type: 'set',
      path: `events/${eventId}/results/${fixture.id}`,
      before: existing,
      data: {
        ...result,
        enteredBy: existing?.enteredBy ?? uid,
        enteredAt: existing?.enteredAt ? ts(existing.enteredAt) : serverTimestamp(),
      },
    },
    {
      type: 'set',
      path: `events/${eventId}/fixtures/${fixture.id}`,
      before: fixture,
      data: { ...fixtureData, scheduledAt: ts(fixture.scheduledAt), status: 'completed', ...(swapTeams ?? {}) },
    },
  ]);
  invalidate(`event:${eventId}`);
}

// ---------- Requests from players (team registrations, leave requests, profile claims) ----------

export async function decideTeam({ uid, team, approve }) {
  const ops = [{ type: 'update', path: `teams/${team.id}`, before: team, data: { status: approve ? 'approved' : 'rejected' } }];
  // The player who registered it becomes its manager and first squad member.
  if (approve && team.managerPlayerId) ops.push({ type: 'update', path: `players/${team.managerPlayerId}`, data: { teamId: team.id } });
  await commit(uid, ops);
  invalidate();
}

export async function decideLeave({ uid, request, approve, team }) {
  const ops = [{ type: 'update', path: `leaveRequests/${request.id}`, before: request, data: { status: approve ? 'approved' : 'declined', decidedBy: uid } }];
  if (approve) {
    ops.push({ type: 'update', path: `players/${request.playerId}`, data: { teamId: null } });
    // A manager who leaves stops being the manager; an admin picks the next one.
    if (team?.managerPlayerId === request.playerId) {
      ops.push({ type: 'update', path: `teams/${team.id}`, before: team, data: { managerUid: null, managerPlayerId: null } });
    }
  }
  await commit(uid, ops);
  invalidate();
}

export async function decideClaim({ uid, claim, approve }) {
  const ops = [{ type: 'update', path: `claims/${claim.id}`, before: claim, data: { status: approve ? 'approved' : 'declined' } }];
  if (approve) {
    ops.push({
      type: 'update',
      path: `players/${claim.playerId}`,
      data: { uid: claim.id, discordId: claim.discordId, discordName: claim.discordName ?? null, avatarUrl: claim.avatarUrl ?? null },
    });
  }
  await commit(uid, ops);
  invalidate();
}

export async function deleteResult({ eventId, fixture, uid, existing }) {
  const fixtureData = storedFixture(fixture);
  await commit(uid, [
    { type: 'delete', path: `events/${eventId}/results/${fixture.id}`, before: existing },
    {
      type: 'set',
      path: `events/${eventId}/fixtures/${fixture.id}`,
      before: fixture,
      data: { ...fixtureData, scheduledAt: ts(fixture.scheduledAt), status: 'scheduled' },
    },
  ]);
  invalidate(`event:${eventId}`);
}
