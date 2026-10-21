// Admin writes. Every save is stamped with who did it (updatedBy) and a server time
// (updatedAt); the security rules reject saves without them, and the server-side
// audit log uses them to record who changed what.

import {
  doc, writeBatch, updateDoc, serverTimestamp, Timestamp,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from './firebase.js';
import { invalidateSeason } from './data.js';

const stamp = (uid) => ({ updatedBy: uid, updatedAt: serverTimestamp() });

// Saves a result and marks the fixture completed, in one go (both or neither).
// swapTeams: { homeTeamId, awayTeamId } if the admin swapped home/away.
export async function saveResult({ seasonId, fixtureId, uid, result, existing, swapTeams = null }) {
  const batch = writeBatch(db);
  batch.set(doc(db, `seasons/${seasonId}/results/${fixtureId}`), {
    ...result,
    ...stamp(uid),
    enteredBy: existing?.enteredBy ?? uid,
    enteredAt: existing?.enteredAt ? Timestamp.fromMillis(existing.enteredAt) : serverTimestamp(),
  });
  batch.update(doc(db, `seasons/${seasonId}/fixtures/${fixtureId}`), {
    status: 'completed',
    ...stamp(uid),
    ...(swapTeams ?? {}),
  });
  await batch.commit();
  invalidateSeason(seasonId);
}

// Deletes a result and puts the fixture back to scheduled.
// The result is stamped first so the audit log knows who deleted it.
export async function deleteResult({ seasonId, fixtureId, uid }) {
  const resultRef = doc(db, `seasons/${seasonId}/results/${fixtureId}`);
  await updateDoc(resultRef, stamp(uid));
  const batch = writeBatch(db);
  batch.delete(resultRef);
  batch.update(doc(db, `seasons/${seasonId}/fixtures/${fixtureId}`), { status: 'scheduled', ...stamp(uid) });
  await batch.commit();
  invalidateSeason(seasonId);
}
