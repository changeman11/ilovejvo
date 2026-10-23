// Firestore storage. The first tests need nothing; the last one runs against the local emulator
// (`npm run dev` in the repo folder) and is skipped when it isn't running.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toFields, fromFields, FirestoreRest } from '../src/store/firestore-rest.js';
import { FirestoreStore } from '../src/store/firestore-store.js';
import { FileStore } from '../src/store/file-store.js';
import { newRecord } from '../src/logic/ratings.js';

test('values survive the trip to Firestore and back; *At numbers become timestamps', () => {
  const game = {
    id: 'g7',
    number: 7,
    open: true,
    winner: null,
    createdAt: 1_790_000_000_000,
    ratio: 0.5,
    teams: { a: { captain: '123456789012345678', players: [{ id: '123456789012345678', name: 'Zed', fake: true }] } },
    votes: {},
    form: 'WLW',
  };
  const fields = toFields(game);
  assert.deepEqual(fields.number, { integerValue: '7' });
  assert.deepEqual(fields.ratio, { doubleValue: 0.5 });
  assert.deepEqual(fields.createdAt, { timestampValue: new Date(1_790_000_000_000).toISOString() });
  assert.deepEqual(fields.winner, { nullValue: null });
  assert.deepEqual(fromFields(fields), game);
});

test('commit sends whole-document writes, masks and "must not exist" checks', async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, body: init.body && JSON.parse(init.body) });
    if (url.includes('accounts:signInWithPassword')) return new Response(JSON.stringify({ idToken: 't', localId: 'botuid', expiresIn: '3600' }));
    return new Response('{}');
  };
  const rest = new FirestoreRest({ projectId: 'p', apiKey: 'k', email: 'e', password: 'pw', fetchFn });
  await rest.commit([
    { path: 'pickupGames/g1', data: { id: 'g1' }, mustNotExist: true },
    { path: 'pickupMeta/bot', data: { lastGame: 1 }, mask: ['lastGame'] },
  ]);
  const commit = calls.at(-1);
  assert.equal(commit.url, 'https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents:commit');
  assert.deepEqual(commit.body.writes[0].currentDocument, { exists: false });
  assert.equal(commit.body.writes[0].update.name, 'projects/p/databases/(default)/documents/pickupGames/g1');
  assert.deepEqual(commit.body.writes[1].updateMask, { fieldPaths: ['lastGame'] });
});

// ---------- against the emulator ----------
const EMU = { firestore: 'http://127.0.0.1:8080', auth: 'http://127.0.0.1:9099' };
async function emulatorRunning() {
  try {
    const [fs, auth] = await Promise.all([
      fetch(EMU.firestore, { signal: AbortSignal.timeout(500) }),
      fetch(EMU.auth, { signal: AbortSignal.timeout(500) }),
    ]);
    return fs.ok !== undefined && auth.ok !== undefined;
  } catch {
    return false;
  }
}
const running = await emulatorRunning();

// The emulator may be your local dev copy of the site, so the test puts things back afterwards.
const DOCS = `${EMU.firestore}/v1/projects/demo-jvo-hub/databases/(default)/documents`;
const OWNER = { authorization: 'Bearer owner', 'content-type': 'application/json' };
const ownerFetch = (path, init = {}) => fetch(`${DOCS}/${path}`, { ...init, headers: OWNER });
const deleteUser = (localId) =>
  fetch(`${EMU.auth}/identitytoolkit.googleapis.com/v1/projects/demo-jvo-hub/accounts:delete`, { method: 'POST', headers: OWNER, body: JSON.stringify({ localId }) });

test('emulator: the bot account saves games and ratings; other accounts are refused by the rules', { skip: !running && 'Firebase emulator not running (npm run dev)' }, async (t) => {
  const firebase = { projectId: 'demo-jvo-hub', apiKey: 'demo-key', email: 'pickup-bot-test@users.ilovejvo.com', password: 'test-password-123', emulator: EMU };
  const id = `t${Date.now()}`;
  const number = 900_000 + Math.floor(Math.random() * 99_999);
  const player = `9${Date.now()}`.padEnd(18, '0');
  const oldMeta = await ownerFetch('pickupMeta/bot');
  const oldMetaBody = oldMeta.ok ? await oldMeta.text() : null;
  const cleanup = [];
  t.after(async () => {
    await ownerFetch(`pickupGames/g${number}`, { method: 'DELETE' });
    await ownerFetch(`pickupRatings/${player}`, { method: 'DELETE' });
    if (oldMetaBody) await ownerFetch('pickupMeta/bot', { method: 'PATCH', body: JSON.stringify({ fields: JSON.parse(oldMetaBody).fields }) });
    else await ownerFetch('pickupMeta/bot', { method: 'DELETE' });
    for (const fn of cleanup) await fn();
  });

  const store = new FirestoreStore({ firebase, startRating: 1000, log: { info() {} } });
  await store.init();
  cleanup.push(() => ownerFetch(`pickupBots/${store.rest.uid}`, { method: 'DELETE' }), () => deleteUser(store.rest.uid));
  const game = {
    id: `g${number}`, number, size: 2, status: 'playing', open: true, createdAt: Date.now(), endedAt: null,
    teams: { a: { captain: player, players: [{ id: player, name: `Tester ${id}` }] }, b: { captain: 'x', players: [{ id: 'x', name: 'X', fake: true }] } },
    votes: {}, winner: null, decidedBy: null, changes: {}, channels: { a: '1', b: '2' }, messageId: 'm',
  };
  await store.createGame(game);
  await assert.rejects(store.createGame(game), /409|ALREADY_EXISTS|exists/i, 'game numbers are never reused');
  assert.ok((await store.openGames()).some((g) => g.id === game.id));

  const record = { ...newRecord(player, `Tester ${id}`, 1000), rating: 1016, games: 1, wins: 1, form: 'W', updatedAt: Date.now() };
  await store.saveResult({ ...game, status: 'done', winner: 'a', open: false }, [record]);
  assert.equal((await store.getGame(game.id)).winner, 'a');
  assert.ok(!(await store.openGames()).some((g) => g.id === game.id));
  await store.setMeta('queueMessageId', '42');

  // A fresh start reads the ratings back.
  const again = new FirestoreStore({ firebase, startRating: 1000, log: { info() {} } });
  await again.init();
  assert.equal(again.rating(player).rating, 1016);
  assert.equal(again.getMeta('queueMessageId'), '42');
  assert.ok(again.nextGameNumber() > number);

  // Someone else with a password account (not in pickupBots) can read but not write.
  const outsider = new FirestoreRest({ ...firebase, email: `someone-${id}@users.ilovejvo.com`, password: 'another-password-1' });
  const made = await outsider.authCall('signUp', { email: outsider.email, password: outsider.password });
  cleanup.push(() => deleteUser(made.data.localId));
  assert.equal((await outsider.get(`pickupRatings/${player}`)).rating, 1016, 'public to read');
  await assert.rejects(outsider.commit([{ path: `pickupRatings/${player}`, data: { ...record, rating: 3000 } }]), /403/);
  // Even the bot can't write a rating under someone else's id, or touch other collections.
  await assert.rejects(store.rest.commit([{ path: `pickupRatings/${player}`, data: { ...record, discordId: 'other' } }]), /403/);
  await assert.rejects(store.rest.commit([{ path: 'settings/faq', data: { text: 'hacked' } }]), /403/);
});

test('file store saves to disk and reads it back', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = await mkdtemp(join(tmpdir(), 'jvo-bot-'));
  try {
    const path = join(dir, 'data', 'pickup.json');
    const store = new FileStore({ path, startRating: 1000 });
    await store.init();
    await store.createGame({ id: 'g1', number: 1, open: true });
    await store.saveResult({ id: 'g1', number: 1, open: false }, [{ ...newRecord('p1', 'One', 1000), games: 1, rating: 1016 }]);
    const again = new FileStore({ path, startRating: 1000 });
    await again.init();
    assert.equal(again.rating('p1').rating, 1016);
    assert.equal(again.nextGameNumber(), 2);
    assert.deepEqual(await again.openGames(), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
