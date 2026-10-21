// I<3JVO server code (Firebase Cloud Functions).
//
// - discordSignIn: swaps a Discord login code for a Firebase sign-in token.
// - devSignIn:     LOCAL EMULATOR ONLY. Signs in a test admin without Discord. Never deployed.
// - auditSeasonWrites: records every change to fixtures/results in /auditLog.
//
// Settings:
//   functions/.env           DISCORD_CLIENT_ID (not secret, safe to commit)
//   DISCORD_CLIENT_SECRET    secret. Live: `firebase functions:secrets:set DISCORD_CLIENT_SECRET`
//                            Local: functions/.secret.local (never committed)

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { setGlobalOptions } = require('firebase-functions/v2');
const { defineSecret, defineString } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp();

// Sydney: closest Google region to Oceania players.
setGlobalOptions({ region: 'australia-southeast1', maxInstances: 5 });

const DISCORD_CLIENT_ID = defineString('DISCORD_CLIENT_ID', { default: '' });
const DISCORD_CLIENT_SECRET = defineSecret('DISCORD_CLIENT_SECRET');

// Creates the Firebase user on first sign-in, or refreshes their name and avatar.
async function upsertUser(uid, displayName, photoURL) {
  const auth = getAuth();
  const profile = { displayName };
  if (photoURL) profile.photoURL = photoURL;
  try {
    await auth.updateUser(uid, profile);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
    await auth.createUser({ uid, ...profile });
  }
}

exports.discordSignIn = onCall({ secrets: [DISCORD_CLIENT_SECRET] }, async (request) => {
  const { code, redirectUri } = request.data ?? {};
  if (typeof code !== 'string' || !code || typeof redirectUri !== 'string'
      || !/^https?:\/\/[^/]+\/auth\/discord$/.test(redirectUri)) {
    throw new HttpsError('invalid-argument', 'Bad sign-in request.');
  }

  const clientId = DISCORD_CLIENT_ID.value();
  const clientSecret = DISCORD_CLIENT_SECRET.value();
  if (!clientId || !clientSecret) {
    throw new HttpsError('failed-precondition', 'Discord sign-in isn’t set up yet.');
  }

  // 1. Swap the one-time code for a Discord access token.
  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) {
    throw new HttpsError('permission-denied', 'Discord didn’t accept the sign-in. Please try again.');
  }
  const { access_token: accessToken } = await tokenRes.json();

  // 2. Ask Discord who this is.
  const userRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!userRes.ok) throw new HttpsError('unavailable', 'Couldn’t reach Discord. Please try again.');
  const discordUser = await userRes.json();

  // 3. Sign them in to Firebase as "discord:<their Discord ID>".
  const uid = `discord:${discordUser.id}`;
  const name = discordUser.global_name || discordUser.username;
  const avatar = discordUser.avatar
    ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png?size=128`
    : null;
  await upsertUser(uid, name, avatar);
  const token = await getAuth().createCustomToken(uid, { discordId: discordUser.id });
  return { token };
});

// Only defined when running in the local emulator, so `firebase deploy` never sees it.
if (process.env.FUNCTIONS_EMULATOR === 'true') {
  exports.devSignIn = onCall(async () => {
    const uid = 'discord:dev-admin';
    await upsertUser(uid, 'Test Admin', null);
    return { token: await getAuth().createCustomToken(uid, { discordId: 'dev-admin' }) };
  });
}

// Audit log: one entry per change to anything inside a season (fixtures, results, rosters...).
// The website stamps `updatedBy` on every admin save (the security rules insist on it),
// so the log knows who did it. Deletes are stamped just before they happen.
// Changes made in the Firebase console or by scripts show as by: null.
async function writeAudit(event, collection, docId) {
  const before = event.data?.before?.exists ? event.data.before.data() : null;
  const after = event.data?.after?.exists ? event.data.after.data() : null;
  if (!before && !after) return;

  await getFirestore().collection('auditLog').add({
    at: FieldValue.serverTimestamp(),
    action: !before ? 'create' : !after ? 'delete' : 'update',
    by: (after ?? before).updatedBy ?? null,
    path: event.document,
    seasonId: event.params.seasonId,
    collection,
    docId,
    before,
    after,
  });
}

exports.auditSeasonWrites = onDocumentWritten('seasons/{seasonId}/{collection}/{docId}', (event) =>
  writeAudit(event, event.params.collection, event.params.docId));

// The season document itself (settings, playoff seeds...).
exports.auditSeasonDocs = onDocumentWritten('seasons/{seasonId}', (event) =>
  writeAudit(event, 'seasons', event.params.seasonId));
