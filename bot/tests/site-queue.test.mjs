// The website queue, against the local Firebase emulator (`npm run dev`; skipped when it isn't
// running): a site player signs up and withdraws through the real rules and live listener, a
// Discord sign-up shows on the site, and the live state is published.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pickup } from '../src/pickup.js';
import { FirestoreStore } from '../src/store/firestore-store.js';
import { FirestoreRest, fromFields } from '../src/store/firestore-rest.js';
import { SiteQueue } from '../src/site-queue.js';

const EMU = { firestore: 'http://127.0.0.1:8080', auth: 'http://127.0.0.1:9099' };
const DOCS = `${EMU.firestore}/v1/projects/demo-jvo-hub/databases/(default)/documents`;
const OWNER = { authorization: 'Bearer owner', 'content-type': 'application/json' };

async function emulatorRunning() {
  try {
    await Promise.all([fetch(EMU.firestore, { signal: AbortSignal.timeout(500) }), fetch(EMU.auth, { signal: AbortSignal.timeout(500) })]);
    return true;
  } catch {
    return false;
  }
}
const running = await emulatorRunning();

// A pretend player signed in with Discord on the site (the emulator accepts unsigned tokens).
async function sitePlayer(discordId) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const token = `${enc({ alg: 'none', typ: 'JWT' })}.${enc({
    iss: 'dev', sub: 'dev', aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now, exp: now + 3600, uid: `discord:${discordId}`, claims: { discordId, discordName: 'Tester' },
  })}.`;
  const res = await fetch(`${EMU.auth}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-key`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, returnSecureToken: true }),
  });
  const { idToken, localId } = await res.json();
  const call = (method, path, body) => fetch(`${DOCS}${path}`, { method, headers: { authorization: `Bearer ${idToken}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  return {
    localId,
    // What the site does: create its own sign-up doc, stamped with the server time.
    signUp: (id = discordId, name = 'Site Player') => call('POST', ':commit', {
      writes: [{
        update: { name: `projects/demo-jvo-hub/databases/(default)/documents/pickupSignups/${id}`, fields: { discordId: { stringValue: id }, name: { stringValue: name } } },
        updateTransforms: [{ fieldPath: 'signedUpAt', setToServerValue: 'REQUEST_TIME' }],
        currentDocument: { exists: false },
      }],
    }),
    withdraw: (id = discordId) => call('DELETE', `/pickupSignups/${id}`),
    // What the site's vote buttons do: change only the vote on your own sign-up.
    vote: (size, id = discordId, extra = {}) => call('PATCH', `/pickupSignups/${id}?updateMask.fieldPaths=vote${Object.keys(extra).map((k) => `&updateMask.fieldPaths=${k}`).join('')}`, {
      fields: { vote: size == null ? { nullValue: null } : { integerValue: String(size) }, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, { stringValue: v }])) },
    }),
    setMode: (size) => call('PATCH', '/pickupControl/mode', { fields: { size: { integerValue: String(size) }, once: { booleanValue: false } } }),
  };
}

const io = {
  async post() { return 'm'; }, async edit() {}, async remove() {}, async createVoice() { return 'v'; }, async createText() { return 't'; },
  async renameChannel() {}, async deleteChannel() {}, async channelSize() { return 0; }, async move() { return true; },
};
const until = async (check, what) => {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for: ${what}`);
};
const getDoc = async (path) => {
  const res = await fetch(`${DOCS}/${path}`, { headers: OWNER });
  return res.ok ? fromFields((await res.json()).fields) : null;
};

test('website queue: sign up and withdraw on the site, Discord sign-ups shown, live state published', { skip: !running && 'Firebase emulator not running (npm run dev)' }, async (t) => {
  const SITE = `95${Date.now()}`.padEnd(18, '1');
  const DISC = `96${Date.now()}`.padEnd(18, '2');
  const firebase = { projectId: 'demo-jvo-hub', apiKey: 'demo-key', email: 'pickup-bot-sitetest@users.ilovejvo.com', password: 'test-password-456', emulator: EMU };
  const store = new FirestoreStore({ firebase, startRating: 1000, log: { info() {} } });
  await store.init();
  const config = { modes: [2, 3, 4, 5, 6], draftOrder: 'alternate', countdownSeconds: 30, readySeconds: 60, pickSeconds: 60, startRating: 1000, k: 32, adminRoleIds: [], allowTestPlayers: false };
  const site = new SiteQueue({ rest: store.rest, firebase, log: { info() {}, warn() {}, error() {} } });
  const pickup = new Pickup({ io, store, config, live: site, log: { info() {}, warn() {}, error() {} } });
  site.attach(pickup);
  const oldLive = await getDoc('pickupMeta/live');
  const oldBot = await getDoc('pickupMeta/bot');
  const oldControl = await getDoc('pickupControl/mode');
  t.after(async () => {
    site.stop();
    for (const id of [SITE, DISC]) await fetch(`${DOCS}/pickupSignups/${id}`, { method: 'DELETE', headers: OWNER });
    if (oldLive) await store.rest.commit([{ path: 'pickupMeta/live', data: oldLive }]);
    else await fetch(`${DOCS}/pickupMeta/live`, { method: 'DELETE', headers: OWNER });
    if (oldControl) await store.rest.commit([{ path: 'pickupControl/mode', data: oldControl }]);
    else await fetch(`${DOCS}/pickupControl/mode`, { method: 'DELETE', headers: OWNER });
    if (oldBot) await store.rest.commit([{ path: 'pickupMeta/bot', data: oldBot }]);
    else await fetch(`${DOCS}/pickupMeta/bot`, { method: 'DELETE', headers: OWNER });
    await fetch(`${DOCS}/pickupBots/${store.rest.uid}`, { method: 'DELETE', headers: OWNER });
    for (const uid of [store.rest.uid, player.localId]) {
      await fetch(`${EMU.auth}/identitytoolkit.googleapis.com/v1/projects/demo-jvo-hub/accounts:delete`, { method: 'POST', headers: OWNER, body: JSON.stringify({ localId: uid }) });
    }
  });
  await pickup.start();
  site.start();

  // A player signs up on the site: the bot puts them in the queue.
  const player = await sitePlayer(SITE);
  assert.equal((await player.signUp()).status, 200);
  await until(() => pickup.queue.has(SITE), 'site sign-up reaches the queue');
  assert.equal(pickup.queue.get(SITE).from, 'site');
  assert.equal(pickup.queue.get(SITE).name, 'Site Player');

  // ...and can't sign anyone else up, or sign up without being signed in.
  assert.equal((await player.signUp(DISC)).status, 403);
  const anon = await fetch(`${DOCS}/pickupSignups?documentId=${DISC}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields: { discordId: { stringValue: DISC }, name: { stringValue: 'x' } } }) });
  assert.equal(anon.status, 403);

  // Someone signs up on Discord: the bot adds their doc so the site lists them.
  await pickup.join(DISC, 'Discord Player');
  await until(async () => (await getDoc(`pickupSignups/${DISC}`))?.name === 'Discord Player', 'Discord sign-up doc');

  // The live state reaches the site.
  await new Promise((r) => setTimeout(r, 1700));
  await until(async () => (await getDoc('pickupMeta/live'))?.queue?.length === 2, 'live state with both players');
  const live = await getDoc('pickupMeta/live');
  assert.deepEqual(live.queue.map((p) => p.from).sort(), ['discord', 'site']);
  assert.ok(live.updatedAt > Date.now() - 60_000);

  // Mode votes: a site vote counts in the bot; a Discord vote shows on the site.
  assert.equal((await player.vote(3)).status, 200);
  await until(() => pickup.votes.get(SITE) === 3, 'site vote reaches the bot');
  assert.equal((await player.vote(3, SITE, { name: 'Renamed' })).status, 403, 'only the vote can change');
  assert.equal((await player.vote(4, DISC)).status, 403, "can't vote for someone else");
  assert.equal((await player.vote(99)).status, 403, 'not a real mode');
  await pickup.select('mode', '2', { id: DISC, name: 'Discord Player', isAdmin: false });
  await until(async () => (await getDoc(`pickupSignups/${DISC}`))?.vote === 2, 'Discord vote copied to the site');

  // The admin-set mode: from the site (here written with the emulator's admin key) and from Discord.
  assert.equal((await player.setMode(4)).status, 403, 'players cannot set the mode');
  await fetch(`${DOCS}/pickupControl/mode`, { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields: { size: { integerValue: '4' }, once: { booleanValue: true } } }) });
  await until(() => pickup.fixedMode?.size === 4 && pickup.fixedMode.once, 'site admin mode reaches the bot');
  await pickup.command('pickup', { sub: 'setmode', choice: 'random' }, { id: 'admin', name: 'Admin', isAdmin: true });
  await until(async () => (await getDoc('pickupControl/mode'))?.size === null, '/pickup setmode reaches the site');
  assert.equal(pickup.fixedMode, null);

  // Withdrawing on the site takes them out of the queue.
  assert.equal((await player.withdraw()).status, 200);
  await until(() => !pickup.queue.has(SITE), 'site withdraw leaves the queue');

  // Withdrawing on Discord removes the doc from the site.
  await pickup.leave(DISC);
  await until(async () => !(await getDoc(`pickupSignups/${DISC}`)), 'Discord withdraw removes the doc');
});
