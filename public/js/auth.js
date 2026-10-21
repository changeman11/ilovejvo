// Admin sign-in with a username and password (Firebase's built-in email/password sign-in,
// free on the Spark plan). A username "george" signs in as george@users.ilovejvo.com;
// those addresses don't need to receive email. Admins are created in the Firebase console.

import {
  getAuth, connectAuthEmulator, onAuthStateChanged, signInWithEmailAndPassword, signOut as fbSignOut,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { app, db } from './firebase.js';
import { useEmulators, emulatorPorts } from './config.js';

export const USERNAME_DOMAIN = 'users.ilovejvo.com';

export const auth = getAuth(app);
if (useEmulators) {
  connectAuthEmulator(auth, `http://${location.hostname}:${emulatorPorts.auth}`, { disableWarnings: true });
}

// "george" -> "george@users.ilovejvo.com". A full email address is used as typed.
export function emailFor(username) {
  const u = String(username).trim().toLowerCase();
  return u.includes('@') ? u : `${u}@${USERNAME_DOMAIN}`;
}

export function usernameOf(user) {
  const email = user?.email ?? '';
  return email.endsWith(`@${USERNAME_DOMAIN}`) ? email.slice(0, -USERNAME_DOMAIN.length - 1) : email;
}

const firstAuthState = new Promise((resolve) => {
  const stop = onAuthStateChanged(auth, (user) => {
    stop();
    resolve(user);
  });
});

export async function currentUser() {
  await firstAuthState;
  return auth.currentUser;
}

// { user, admin } where admin is the /admins doc or null.
export async function currentAdmin() {
  const user = await currentUser();
  if (!user) return { user: null, admin: null };
  const snap = await getDoc(doc(db, 'admins', user.uid));
  return { user, admin: snap.exists() ? snap.data() : null };
}

export function onUserChange(callback) {
  return onAuthStateChanged(auth, callback);
}

// Friendly messages for the common sign-in failures.
export async function signIn(username, password) {
  try {
    await signInWithEmailAndPassword(auth, emailFor(username), password);
  } catch (err) {
    const wrong = ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email'];
    if (wrong.includes(err.code)) throw new Error('Wrong username or password.');
    if (err.code === 'auth/too-many-requests') throw new Error('Too many tries. Wait a few minutes and try again.');
    throw new Error('Couldn’t sign in. Check your connection and try again.');
  }
}

export function signOut() {
  return fbSignOut(auth);
}
