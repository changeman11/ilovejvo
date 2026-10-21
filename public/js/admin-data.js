// Admin writes. Every change is saved together with an audit log entry (see writes.js).

import { commit as save, ts, newId, serverTimestamp } from './writes.js';
import { invalidate } from './data.js';

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
    ...bundle.fixtures.map((f) => ({ type: 'delete', path: `events/${id}/fixtures/${f.id}`, before: f })),
    ...Object.values(bundle.results).map((r) => ({ type: 'delete', path: `events/${id}/results/${r.id}`, before: r })),
    ...Object.values(bundle.rosters).map((r) => ({ type: 'delete', path: `events/${id}/rosters/${r.id}`, before: r })),
    { type: 'delete', path: `events/${id}`, before: bundle.event },
  ];
  await commit(uid, ops);
  invalidate('event');
}

// ---------- Teams and players ----------

export async function saveTeam({ id, uid, team, existing }) {
  await commit(uid, [{ type: 'set', path: `teams/${id}`, before: existing, data: team }]);
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

// ---------- Inside an event ----------

export async function saveRoster({ eventId, teamId, uid, roster, existing }) {
  await commit(uid, [{ type: 'set', path: `events/${eventId}/rosters/${teamId}`, before: existing, data: roster }]);
  invalidate(`event:${eventId}`);
}

export async function saveFixture({ eventId, id, uid, fixture, existing }) {
  const fixtureId = id ?? newId(`events/${eventId}/fixtures`);
  await commit(uid, [{
    type: 'set',
    path: `events/${eventId}/fixtures/${fixtureId}`,
    before: existing,
    data: { ...fixture, scheduledAt: ts(fixture.scheduledAt) },
  }]);
  invalidate(`event:${eventId}`);
  return fixtureId;
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
  const { id: _id, round: _round, ...fixtureData } = fixture;
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
  const { id: _id, round: _round, ...fixtureData } = fixture;
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
