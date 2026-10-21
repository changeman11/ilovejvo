// Admin writes. Every change is saved together with an audit log entry, all or nothing.
// The security rules insist on the updatedBy/updatedAt stamp and on audit entries being
// signed with the admin's own uid, and nobody can edit or delete the log.

import {
  doc, collection, writeBatch, serverTimestamp, Timestamp,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from './firebase.js';
import { invalidate } from './data.js';

const stamp = (uid) => ({ updatedBy: uid, updatedAt: serverTimestamp() });
const strip = (obj) => {
  if (!obj) return null;
  const { id, ...rest } = obj;
  return rest;
};

// ops: [{ type: 'set' | 'delete', path, data?, before? }]
async function commit(uid, ops) {
  // A batch holds 500 writes; each op is 2 (the change + its audit entry).
  for (let i = 0; i < ops.length; i += 240) {
    const batch = writeBatch(db);
    for (const op of ops.slice(i, i + 240)) {
      const ref = doc(db, op.path);
      const after = op.type === 'delete' ? null : { ...op.data, ...stamp(uid) };
      if (op.type === 'delete') batch.delete(ref);
      else batch.set(ref, after);
      batch.set(doc(collection(db, 'auditLog')), {
        at: serverTimestamp(),
        by: uid,
        action: op.type === 'delete' ? 'delete' : op.before ? 'update' : 'create',
        path: op.path,
        before: strip(op.before),
        after,
      });
    }
    await batch.commit();
  }
}

const ts = (ms) => (ms ? Timestamp.fromMillis(ms) : null);

// Readable ids from names ("Tasman Tide" -> "tasman-tide"), unique among `taken`.
export function slugId(name, taken) {
  const base = String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

// ---------- Events ----------

export async function saveEvent({ id, uid, event, existing }) {
  const eventId = id ?? doc(collection(db, 'events')).id;
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
  const fixtureId = id ?? doc(collection(db, `events/${eventId}/fixtures`)).id;
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
