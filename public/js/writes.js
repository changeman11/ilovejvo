// Every save goes through commit(): the change(s) plus one audit entry each, all or nothing.
// The security rules insist on the updatedBy/updatedAt stamp and on audit entries being
// signed with the writer's own uid; nobody can edit or delete the log.

import {
  doc, collection, writeBatch, serverTimestamp, Timestamp,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db, adminDb } from './firebase.js';

export { serverTimestamp };

export const stamp = (uid) => ({ updatedBy: uid, updatedAt: serverTimestamp() });
export const ts = (ms) => (ms ? Timestamp.fromMillis(ms) : null);
export const newId = (collectionPath) => doc(collection(db, collectionPath)).id;

const strip = (obj) => {
  if (!obj) return null;
  const { id, ...rest } = obj;
  return rest;
};

// ops: [{ type: 'set' | 'update' | 'delete', path, data?, before? }]
//   set    = write the whole document (create or replace)
//   update = change only the given fields
// admin: save through the admin sign-in (admin pages) instead of the player one.
export async function commit(uid, ops, { admin = false } = {}) {
  const database = admin ? adminDb : db;
  // A batch holds 500 writes; each op is 2 (the change + its audit entry).
  for (let i = 0; i < ops.length; i += 240) {
    const batch = writeBatch(database);
    for (const op of ops.slice(i, i + 240)) {
      const ref = doc(database, op.path);
      const after = op.type === 'delete' ? null : { ...op.data, ...stamp(uid) };
      if (op.type === 'delete') batch.delete(ref);
      else if (op.type === 'update') batch.update(ref, after);
      else batch.set(ref, after);
      batch.set(doc(collection(database, 'auditLog')), {
        at: serverTimestamp(),
        by: uid,
        action: op.type === 'delete' ? 'delete' : op.before || op.type === 'update' ? 'update' : 'create',
        path: op.path,
        before: strip(op.before),
        after,
      });
    }
    await batch.commit();
  }
}
