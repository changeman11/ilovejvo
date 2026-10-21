// Admin writes. Every save is stamped with who did it (updatedBy) and a server time
// (updatedAt); the security rules reject saves without them, and the server-side
// audit log uses them to record who changed what.

import {
  doc, collection, setDoc, deleteDoc, writeBatch, updateDoc, serverTimestamp, Timestamp,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from './firebase.js';
import { invalidateSeason, invalidateEvents } from './data.js';

const stamp = (uid) => ({ updatedBy: uid, updatedAt: serverTimestamp() });
const fixtureRef = (seasonId, id) => doc(db, `seasons/${seasonId}/fixtures/${id}`);

// ---------- Events ----------

// Creates (id = null) or replaces an event. Returns its id.
// event.date is milliseconds or null (TBD).
export async function saveEvent({ id, uid, event, existing }) {
  const ref = id ? doc(db, `events/${id}`) : doc(collection(db, 'events'));
  await setDoc(ref, {
    ...event,
    date: event.date ? Timestamp.fromMillis(event.date) : null,
    createdAt: existing?.createdAt ? Timestamp.fromMillis(existing.createdAt) : serverTimestamp(),
    createdBy: existing?.createdBy ?? uid,
    ...stamp(uid),
  });
  invalidateEvents();
  return ref.id;
}

// Deletes an event, stamping it first so the audit log records who did it.
export async function deleteEvent({ id, uid }) {
  const ref = doc(db, `events/${id}`);
  await updateDoc(ref, stamp(uid));
  await deleteDoc(ref);
  invalidateEvents();
}

// ---------- League ----------

// Playoff auto-advance: fill in (or clear) later-round teams, in the same batch.
function addAdvance(batch, seasonId, uid, advance = []) {
  for (const a of advance) {
    batch.update(fixtureRef(seasonId, a.fixtureId), { homeTeamId: a.homeTeamId, awayTeamId: a.awayTeamId, ...stamp(uid) });
  }
}

// Saves a result and marks the fixture completed, in one go (all or nothing).
// swapTeams: { homeTeamId, awayTeamId } if the admin swapped home/away.
// advance:   playoff fixtures whose teams change because of this result.
export async function saveResult({ seasonId, fixtureId, uid, result, existing, swapTeams = null, advance = [] }) {
  const batch = writeBatch(db);
  batch.set(doc(db, `seasons/${seasonId}/results/${fixtureId}`), {
    ...result,
    ...stamp(uid),
    enteredBy: existing?.enteredBy ?? uid,
    enteredAt: existing?.enteredAt ? Timestamp.fromMillis(existing.enteredAt) : serverTimestamp(),
  });
  batch.update(fixtureRef(seasonId, fixtureId), { status: 'completed', ...stamp(uid), ...(swapTeams ?? {}) });
  addAdvance(batch, seasonId, uid, advance);
  await batch.commit();
  invalidateSeason(seasonId);
}

// Deletes a result and puts the fixture back to scheduled.
// The result is stamped first so the audit log knows who deleted it.
export async function deleteResult({ seasonId, fixtureId, uid, advance = [] }) {
  const resultRef = doc(db, `seasons/${seasonId}/results/${fixtureId}`);
  await updateDoc(resultRef, stamp(uid));
  const batch = writeBatch(db);
  batch.delete(resultRef);
  batch.update(fixtureRef(seasonId, fixtureId), { status: 'scheduled', ...stamp(uid) });
  addAdvance(batch, seasonId, uid, advance);
  await batch.commit();
  invalidateSeason(seasonId);
}

// Creates the playoff bracket: locks the seeds on the season and adds the playoff fixtures.
export async function createPlayoffs({ seasonId, uid, playoffs, fixtures }) {
  const batch = writeBatch(db);
  batch.update(doc(db, `seasons/${seasonId}`), { playoffs, ...stamp(uid) });
  for (const { id, ...f } of fixtures) batch.set(fixtureRef(seasonId, id), { ...f, ...stamp(uid) });
  await batch.commit();
  invalidateSeason(seasonId);
}

// Removes a bracket that hasn't started (no playoff results yet).
// Fixtures are stamped first so the audit log records who removed them.
export async function resetPlayoffs({ seasonId, uid, playoffs, fixtureIds }) {
  const first = writeBatch(db);
  for (const id of fixtureIds) first.update(fixtureRef(seasonId, id), stamp(uid));
  await first.commit();
  const batch = writeBatch(db);
  for (const id of fixtureIds) batch.delete(fixtureRef(seasonId, id));
  batch.update(doc(db, `seasons/${seasonId}`), { playoffs, ...stamp(uid) });
  await batch.commit();
  invalidateSeason(seasonId);
}

// Sets (or clears) the date and time of a fixture.
export async function setFixtureTime({ seasonId, fixtureId, uid, scheduledAt }) {
  await updateDoc(fixtureRef(seasonId, fixtureId), {
    scheduledAt: scheduledAt ? Timestamp.fromMillis(scheduledAt) : null,
    ...stamp(uid),
  });
  invalidateSeason(seasonId);
}
