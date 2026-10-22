import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { handle } from '../worker/src/index.js';
import { parseMediaPath, sniffImage, verifyIdToken, resetKeyCache, MAX_BYTES } from '../worker/src/media.js';

const PROJECT = 'i-love-jvo';
const SITE = 'https://i-love-jvo.web.app';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const now = Math.floor(Date.now() / 1000);

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function idToken(uid, { provider = 'custom', aud = PROJECT, exp = now + 3600, kid = 'k1', key = privateKey } = {}) {
  const head = b64({ alg: 'RS256', kid, typ: 'JWT' });
  const body = b64({ iss: `https://securetoken.google.com/${PROJECT}`, aud, sub: uid, iat: now - 10, exp, firebase: { sign_in_provider: provider } });
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(key).toString('base64url');
  return `${head}.${body}.${sig}`;
}

// Pretend database: who manages/owns what, and who is an admin.
const docs = {
  'teams/tide': { managerUid: { stringValue: 'discord:1' } },
  'players/kai': { uid: { stringValue: 'discord:2' } },
  'admins/boss': { name: { stringValue: 'Boss' } },
};
const fakeFetch = async (url) => {
  if (url.includes('securetoken@system')) return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'Cache-Control': 'max-age=600' } });
  const m = /documents\/(.+)$/.exec(url);
  if (m && docs[m[1]]) return new Response(JSON.stringify({ fields: docs[m[1]] }));
  return new Response('{}', { status: 404 });
};

function fakeKv() {
  const store = new Map();
  return {
    store,
    async put(k, v, { metadata } = {}) { store.set(k, { value: v, metadata }); },
    async getWithMetadata(k) { return store.get(k) ?? { value: null, metadata: null }; },
    async delete(k) { store.delete(k); },
  };
}
const envWith = (kv) => ({ FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: SITE, MEDIA: kv });

const GIF = Uint8Array.from(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
const put = (path, token, { body = GIF, type = 'image/gif', origin = SITE } = {}) => new Request(`https://w.example/media/${path}`, {
  method: 'PUT', body, headers: { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': type, 'Content-Length': String(body.byteLength) },
});

test('media paths: only known owners, kinds and file names', () => {
  assert.equal(parseMediaPath('/media/teams/tide/logo/abc123.gif').key, 'teams/tide/logo/abc123.gif');
  assert.equal(parseMediaPath('/media/players/kai/avatar/x.webp').kind, 'avatar');
  assert.equal(parseMediaPath('/media/players/kai/shot/x.webp').kind, 'shot', 'match screenshots for votes');
  assert.equal(parseMediaPath('/media/teams/tide/shot/x.webp'), null, 'screenshots belong to players');
  assert.equal(parseMediaPath('/media/teams/tide/avatar/x.gif'), null, 'teams have logos, not avatars');
  assert.equal(parseMediaPath('/media/players/kai/logo/x.gif'), null);
  assert.equal(parseMediaPath('/media/teams/../admins/logo/x.gif'), null);
  assert.equal(parseMediaPath('/media/teams/tide/logo/x.svg'), null, 'no SVG (could carry scripts)');
});

test('file sniffing recognises real images only', () => {
  assert.equal(sniffImage(GIF.buffer), 'gif');
  assert.equal(sniffImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]).buffer), 'png');
  assert.equal(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]).buffer), 'jpg');
  assert.equal(sniffImage(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ').buffer), 'webp');
  assert.equal(sniffImage(new TextEncoder().encode('<html><script>').buffer), null);
});

test('sign-in tokens: Google-signed, right project, not expired', async () => {
  resetKeyCache();
  const env = { FIREBASE_PROJECT_ID: PROJECT };
  assert.deepEqual(await verifyIdToken(idToken('discord:1'), env, fakeFetch), { uid: 'discord:1', provider: 'custom' });
  assert.equal(await verifyIdToken(idToken('discord:1', { aud: 'other-project' }), env, fakeFetch), null);
  assert.equal(await verifyIdToken(idToken('discord:1', { exp: now - 5 }), env, fakeFetch), null);
  assert.equal(await verifyIdToken(idToken('discord:1', { kid: 'nope' }), env, fakeFetch), null);
  const { privateKey: otherKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.equal(await verifyIdToken(idToken('discord:1', { key: otherKey }), env, fakeFetch), null, 'forged signature');
  const unsigned = `${b64({ alg: 'none' })}.${idToken('discord:1').split('.')[1]}.`;
  assert.equal(await verifyIdToken(unsigned, env, fakeFetch), null, 'unsigned tokens only on this computer');
  assert.equal((await verifyIdToken(unsigned, { ...env, DEV_MODE: '1' }, fakeFetch)).uid, 'discord:1');
});

test('manager uploads a team logo; anyone can view it', async () => {
  resetKeyCache();
  const kv = fakeKv();
  const res = await handle(put('teams/tide/logo/a1.gif', idToken('discord:1')), envWith(kv), fakeFetch);
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), SITE);
  assert.deepEqual(await res.json(), { path: 'teams/tide/logo/a1.gif' });
  assert.equal(kv.store.get('teams/tide/logo/a1.gif').metadata.by, 'discord:1');

  const get = await handle(new Request('https://w.example/media/teams/tide/logo/a1.gif'), envWith(kv), fakeFetch);
  assert.equal(get.status, 200);
  assert.equal(get.headers.get('Content-Type'), 'image/gif');
  assert.equal(get.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(get.headers.get('Cache-Control'), /immutable/);
  assert.equal(new Uint8Array(await get.arrayBuffer()).length, GIF.length);
  assert.equal((await handle(new Request('https://w.example/media/teams/tide/logo/zz.gif'), envWith(kv), fakeFetch)).status, 404);
});

test('refuses other people, other sites, fake images and big files', async () => {
  resetKeyCache();
  const kv = fakeKv();
  const env = envWith(kv);
  assert.equal((await handle(put('teams/tide/logo/a.gif', idToken('discord:2')), env, fakeFetch)).status, 403, 'not the manager');
  assert.equal((await handle(put('players/kai/avatar/a.gif', idToken('discord:1')), env, fakeFetch)).status, 403, 'not their player');
  assert.equal((await handle(put('players/kai/avatar/a.gif', 'garbage'), env, fakeFetch)).status, 401);
  assert.equal((await handle(put('players/kai/avatar/a.gif', idToken('discord:2'), { origin: 'https://evil.example' }), env, fakeFetch)).status, 403);
  const html = new TextEncoder().encode('<html><script>alert(1)</script>');
  assert.equal((await handle(put('players/kai/avatar/a.gif', idToken('discord:2'), { body: html }), env, fakeFetch)).status, 415);
  assert.equal((await handle(put('players/kai/avatar/a.gif', idToken('discord:2'), { type: 'text/html' }), env, fakeFetch)).status, 415);
  const big = new Uint8Array(MAX_BYTES.avatar + 1);
  big.set(GIF);
  assert.equal((await handle(put('players/kai/avatar/a.gif', idToken('discord:2'), { body: big }), env, fakeFetch)).status, 413);
  big.set(GIF);
  const okBanner = new Uint8Array(3 * 1024 * 1024);
  okBanner.set(GIF);
  assert.equal((await handle(put('players/kai/banner/b.gif', idToken('discord:2'), { body: okBanner }), env, fakeFetch)).status, 201, 'banners may be bigger');
  assert.equal(kv.store.size, 1);
});

test('admins (password sign-in + admin list) can remove anything; owners can remove their own', async () => {
  resetKeyCache();
  const kv = fakeKv();
  const env = envWith(kv);
  await handle(put('players/kai/avatar/a.gif', idToken('discord:2')), env, fakeFetch);
  const del = (path, token) => new Request(`https://w.example/media/${path}`, { method: 'DELETE', headers: { Origin: SITE, Authorization: `Bearer ${token}` } });
  assert.equal((await handle(del('players/kai/avatar/a.gif', idToken('boss', { provider: 'custom' })), env, fakeFetch)).status, 403, 'admin list alone is not enough');
  assert.equal((await handle(del('players/kai/avatar/a.gif', idToken('boss', { provider: 'password' })), env, fakeFetch)).status, 200);
  assert.equal(kv.store.size, 0);
  await handle(put('players/kai/avatar/b.gif', idToken('discord:2')), env, fakeFetch);
  assert.equal((await handle(del('players/kai/avatar/b.gif', idToken('discord:2')), env, fakeFetch)).status, 200);
  assert.equal(kv.store.size, 0);
});
