// Starts Firebase and shares the connections with the rest of the app.
//
// Two separate connections, so a person can be signed in to both at once:
// - `app` / `db`: the public site and players (Discord sign-in).
// - `adminApp` / `adminDb`: the admin area (username + password sign-in).
// Signing in or out of one doesn't touch the other.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  initializeFirestore,
  connectFirestoreEmulator,
  memoryLocalCache,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig, useEmulators, emulatorPorts } from './config.js';

export const app = initializeApp(firebaseConfig);
export const adminApp = initializeApp(firebaseConfig, 'admin');

// Each tab keeps its own in-memory copy. (A shared offline copy across tabs was dropped on
// 2026-10-23: one tab "owns" the connection, and when that tab sits frozen in the background the
// other tabs stop getting live updates, which broke the live chat.)
// Long polling is used automatically on networks that block the normal live connection.
export const db = initializeFirestore(app, { localCache: memoryLocalCache(), experimentalAutoDetectLongPolling: true });
// Admin data is always fetched fresh, so no offline copy is kept.
export const adminDb = initializeFirestore(adminApp, { localCache: memoryLocalCache() });

// Admins marked `discord: true` in /admins can run admin pages from their Discord sign-in (no
// separate login). auth.js currentAdmin() switches this on; admin reads and saves then go through
// the player connection instead of the admin one.
let discordAdmin = false;
export function setDiscordAdmin(on) { discordAdmin = on; }
export const usingDiscordAdmin = () => discordAdmin;
export const adminDatabase = () => (discordAdmin ? db : adminDb);

if (useEmulators) {
  connectFirestoreEmulator(db, location.hostname, emulatorPorts.firestore);
  connectFirestoreEmulator(adminDb, location.hostname, emulatorPorts.firestore);
}
