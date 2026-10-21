// Sign-in: Discord for real, plus a test-admin button that only works in the local emulator.
//
// Discord flow:
//   1. startDiscordSignIn() sends the browser to Discord with a random "state" value.
//   2. Discord sends it back to /auth/discord?code=...&state=...
//   3. finishDiscordSignIn() checks the state, sends the code to the discordSignIn
//      Cloud Function, and signs in with the token it returns.

import {
  getAuth, connectAuthEmulator, onAuthStateChanged, signInWithCustomToken, signOut as fbSignOut,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFunctions, connectFunctionsEmulator, httpsCallable,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { app, db } from './firebase.js';
import { useEmulators, emulatorPorts, functionsRegion, discordClientId } from './config.js';

export const auth = getAuth(app);
const functions = getFunctions(app, functionsRegion);
if (useEmulators) {
  connectAuthEmulator(auth, `http://${location.hostname}:${emulatorPorts.auth}`, { disableWarnings: true });
  connectFunctionsEmulator(functions, location.hostname, emulatorPorts.functions);
}

export const discordConfigured = Boolean(discordClientId);
export const devSignInAvailable = useEmulators;

const STATE_KEY = 'jvo.discordSignIn';
const redirectUri = () => `${location.origin}/auth/discord`;

// Resolves once Firebase knows whether someone is signed in (on page load).
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

// { user, admin } where admin is the /admins doc or null. Checked fresh each time.
export async function currentAdmin() {
  const user = await currentUser();
  if (!user) return { user: null, admin: null };
  const snap = await getDoc(doc(db, 'admins', user.uid));
  return { user, admin: snap.exists() ? snap.data() : null };
}

export function onUserChange(callback) {
  return onAuthStateChanged(auth, callback);
}

// The Discord user ID inside a uid like "discord:123456789".
export function discordIdOf(user) {
  return user?.uid?.startsWith('discord:') ? user.uid.slice('discord:'.length) : null;
}

export function startDiscordSignIn(returnTo = '/admin') {
  if (!discordConfigured) throw new Error('Discord sign-in isn’t set up yet');
  const state = crypto.randomUUID();
  try {
    sessionStorage.setItem(STATE_KEY, JSON.stringify({ state, returnTo }));
  } catch {
    // Storage blocked: sign-in can't be verified on return, so stop here.
    throw new Error('Your browser is blocking storage, which sign-in needs. Try a normal (not private) window.');
  }
  const params = new URLSearchParams({
    client_id: discordClientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: 'identify',
    state,
    prompt: 'none',
  });
  location.assign(`https://discord.com/oauth2/authorize?${params}`);
}

// Called on /auth/discord. Returns the page to go to next.
export async function finishDiscordSignIn() {
  const params = new URLSearchParams(location.search);
  if (params.get('error')) throw new Error('Sign-in was cancelled on Discord.');

  let saved = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(STATE_KEY) ?? 'null');
    sessionStorage.removeItem(STATE_KEY);
  } catch { /* handled below */ }
  if (!saved || !params.get('state') || saved.state !== params.get('state')) {
    throw new Error('This sign-in link has expired or didn’t come from this site. Please try again.');
  }

  const { data } = await httpsCallable(functions, 'discordSignIn')({ code: params.get('code'), redirectUri: redirectUri() });
  await signInWithCustomToken(auth, data.token);
  return saved.returnTo?.startsWith('/') ? saved.returnTo : '/admin';
}

// Local emulator only: sign in as "Test Admin" without Discord.
export async function devSignIn() {
  if (!devSignInAvailable) throw new Error('Test sign-in only works on your own computer.');
  const { data } = await httpsCallable(functions, 'devSignIn')();
  await signInWithCustomToken(auth, data.token);
}

export function signOut() {
  return fbSignOut(auth);
}
