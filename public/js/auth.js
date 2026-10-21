// Sign-in. Two independent sign-ins can be active at once (see firebase.js):
// - Players: Discord (`auth`). The browser goes to Discord, comes back to /auth/discord with a
//   one-time code, and our Cloudflare Worker swaps it for a Firebase token (uid "discord:<id>").
// - Admins: username + password (`adminAuth`; "jvo" = jvo@users.ilovejvo.com).
// - On this computer only (emulator): pretend Discord users, so everything can be tested offline.

import {
  getAuth, connectAuthEmulator, onAuthStateChanged, signInWithEmailAndPassword, signInWithCustomToken, signOut as fbSignOut,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { app, adminApp, adminDb } from './firebase.js';
import { useEmulators, emulatorPorts, discordClientId, authWorkerUrl } from './config.js';

export const USERNAME_DOMAIN = 'users.ilovejvo.com';

export const auth = getAuth(app); // players
export const adminAuth = getAuth(adminApp); // admins
if (useEmulators) {
  for (const a of [auth, adminAuth]) connectAuthEmulator(a, `http://${location.hostname}:${emulatorPorts.auth}`, { disableWarnings: true });
}

export const discordReady = Boolean(discordClientId && authWorkerUrl);

// "jvo" -> "jvo@users.ilovejvo.com". A full email address is used as typed.
export function emailFor(username) {
  const u = String(username).trim().toLowerCase();
  return u.includes('@') ? u : `${u}@${USERNAME_DOMAIN}`;
}

export function usernameOf(user) {
  const email = user?.email ?? '';
  return email.endsWith(`@${USERNAME_DOMAIN}`) ? email.slice(0, -USERNAME_DOMAIN.length - 1) : email;
}

const firstState = (a) => new Promise((resolve) => {
  const stop = onAuthStateChanged(a, (user) => {
    stop();
    resolve(user);
  });
});
const firstPlayerState = firstState(auth);
const firstAdminState = firstState(adminAuth);

// The signed-in player (Discord), or null.
export async function currentUser() {
  await firstPlayerState;
  return auth.currentUser;
}

// Discord details from the sign-in token: { discordId, discordName } or null.
export async function discordOf(user) {
  if (!user?.uid?.startsWith('discord:')) return null;
  const { claims } = await user.getIdTokenResult();
  return { discordId: claims.discordId ?? user.uid.slice(8), discordName: claims.discordName ?? null };
}

// The admin sign-in: { user, admin } where admin is the /admins doc or null.
// Admin powers only count for password sign-ins (the security rules insist on the same).
export async function currentAdmin() {
  await firstAdminState;
  const user = adminAuth.currentUser;
  if (!user) return { user: null, admin: null };
  if (!user.providerData.some((p) => p.providerId === 'password')) return { user, admin: null };
  const snap = await getDoc(doc(adminDb, 'admins', user.uid));
  return { user, admin: snap.exists() ? snap.data() : null };
}

export function onUserChange(callback) {
  return onAuthStateChanged(auth, callback);
}

export function onAdminChange(callback) {
  return onAuthStateChanged(adminAuth, callback);
}

// ---------- Admin: username + password ----------

export async function signIn(username, password) {
  try {
    await signInWithEmailAndPassword(adminAuth, emailFor(username), password);
  } catch (err) {
    const wrong = ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email'];
    if (wrong.includes(err.code)) throw new Error('Wrong username or password.');
    if (err.code === 'auth/too-many-requests') throw new Error('Too many tries. Wait a few minutes and try again.');
    throw new Error('Couldn’t sign in. Check your connection and try again.');
  }
}

// Signs the player (Discord) out. The admin sign-in is untouched.
export function signOut() {
  return fbSignOut(auth);
}

// Signs the admin out. The player (Discord) sign-in is untouched.
export function adminSignOut() {
  return fbSignOut(adminAuth);
}

// ---------- Players: Discord ----------

const STATE_KEY = 'jvo.discordSignIn';
const PROFILE_KEY = 'jvo.discordProfile';
const redirectUri = () => `${location.origin}/auth/discord`;

export function startDiscordSignIn(returnTo = '/me') {
  if (!discordReady) throw new Error('Discord sign-in isn’t switched on yet.');
  const state = crypto.randomUUID();
  try {
    sessionStorage.setItem(STATE_KEY, JSON.stringify({ state, returnTo }));
  } catch {
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
  const res = await fetch(`${authWorkerUrl.replace(/\/$/, '')}/discord`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: params.get('code'), redirectUri: redirectUri() }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'Sign-in didn’t work. Please try again.');
  try { sessionStorage.setItem(PROFILE_KEY, JSON.stringify(body.profile ?? {})); } catch { /* optional */ }
  await signInWithCustomToken(auth, body.token);
  return saved.returnTo?.startsWith('/') ? saved.returnTo : '/me';
}

// Discord name/avatar from the last sign-in (used to pre-fill a new profile).
export function lastDiscordProfile() {
  try { return JSON.parse(sessionStorage.getItem(PROFILE_KEY) ?? 'null'); } catch { return null; }
}

// ---------- This computer only: pretend Discord users ----------

export const devSignInAvailable = useEmulators;
export const DEV_USERS = [
  { discordId: '1001', name: 'Wavecrash', note: 'manages Tasman Tide' },
  { discordId: '1002', name: 'Coralyn', note: 'plays for Reef Raiders' },
  { discordId: '1003', name: 'Drift', note: 'free agent' },
  { discordId: '1004', name: 'Newbie', note: 'no profile yet' },
];

// The Auth emulator accepts unsigned tokens, so we can make one in the browser.
export async function devSignIn(discordId) {
  if (!devSignInAvailable) throw new Error('Test sign-in only works on your own computer.');
  const u = DEV_USERS.find((x) => x.discordId === discordId);
  const enc = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const now = Math.floor(Date.now() / 1000);
  const token = `${enc({ alg: 'none', typ: 'JWT' })}.${enc({
    iss: 'dev', sub: 'dev', aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now, exp: now + 3600, uid: `discord:${discordId}`, claims: { discordId, discordName: u?.name ?? 'Tester' },
  })}.`;
  try { sessionStorage.setItem(PROFILE_KEY, JSON.stringify({ discordId, name: u?.name ?? 'Tester', avatarUrl: null })); } catch { /* optional */ }
  await signInWithCustomToken(auth, token);
}
