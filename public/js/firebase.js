// Starts Firebase once and shares the database connection with the rest of the app.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  initializeFirestore,
  connectFirestoreEmulator,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig, useEmulators, emulatorPorts } from './config.js';

export const app = initializeApp(firebaseConfig);

// Offline cache: the last data you saw still shows when you lose signal.
// Falls back to memory-only if the browser blocks storage (e.g. some private windows).
let localCache;
try {
  localCache = persistentLocalCache({ tabManager: persistentMultipleTabManager() });
} catch {
  localCache = memoryLocalCache();
}

export const db = initializeFirestore(app, { localCache });

if (useEmulators) {
  connectFirestoreEmulator(db, location.hostname, emulatorPorts.firestore);
}
