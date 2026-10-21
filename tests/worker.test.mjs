import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { createCustomToken, handle, allowedOrigin } from '../worker/src/index.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const sa = { client_email: 'discord-signin@i-love-jvo.iam.gserviceaccount.com', private_key: pem };
const env = {
  DISCORD_CLIENT_ID: '123',
  DISCORD_CLIENT_SECRET: 'shh',
  FIREBASE_SERVICE_ACCOUNT: JSON.stringify(sa),
  ALLOWED_ORIGINS: 'https://i-love-jvo.web.app, http://127.0.0.1:5000',
};
const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString());

test('custom token is a valid RS256 JWT for Firebase', async () => {
  const token = await createCustomToken({ clientEmail: sa.client_email, privateKey: pem }, 'discord:42', { discordId: '42' }, 1000);
  const [h, p, s] = token.split('.');
  assert.deepEqual(decode(h), { alg: 'RS256', typ: 'JWT' });
  const payload = decode(p);
  assert.equal(payload.uid, 'discord:42');
  assert.equal(payload.iss, sa.client_email);
  assert.equal(payload.exp - payload.iat, 3600);
  assert.equal(payload.aud, 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit');
  assert.deepEqual(payload.claims, { discordId: '42' });
  const verify = createVerify('RSA-SHA256');
  verify.update(`${h}.${p}`);
  assert.equal(verify.verify(publicKey, Buffer.from(s, 'base64url')), true);
});

test('only listed sites may use it', () => {
  assert.equal(allowedOrigin('https://i-love-jvo.web.app', env), 'https://i-love-jvo.web.app');
  assert.equal(allowedOrigin('https://evil.example', env), null);
});

const req = (body, origin = 'https://i-love-jvo.web.app') => new Request('https://w.example/discord', {
  method: 'POST',
  headers: { Origin: origin, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// Pretend Discord.
const fakeDiscord = async (url, init) => {
  if (url.includes('/oauth2/token')) {
    const p = new URLSearchParams(init.body);
    if (p.get('code') !== 'good' || p.get('client_secret') !== 'shh') return new Response('{}', { status: 400 });
    return new Response(JSON.stringify({ access_token: 'at' }));
  }
  if (url.includes('/users/@me')) return new Response(JSON.stringify({ id: '777', username: 'wave', global_name: 'Wavecrash', avatar: 'abc' }));
  return new Response('', { status: 404 });
};

test('good code -> token for discord:<id> plus profile', async () => {
  const res = await handle(req({ code: 'good', redirectUri: 'https://i-love-jvo.web.app/auth/discord' }), env, fakeDiscord);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://i-love-jvo.web.app');
  const body = await res.json();
  assert.equal(decode(body.token.split('.')[1]).uid, 'discord:777');
  assert.equal(decode(body.token.split('.')[1]).claims.discordName, 'Wavecrash');
  assert.equal(body.profile.avatarUrl, 'https://cdn.discordapp.com/avatars/777/abc.png?size=128');
});

test('rejects bad codes, wrong sites and mismatched redirects', async () => {
  assert.equal((await handle(req({ code: 'bad', redirectUri: 'https://i-love-jvo.web.app/auth/discord' }), env, fakeDiscord)).status, 401);
  assert.equal((await handle(req({ code: 'good', redirectUri: 'https://i-love-jvo.web.app/auth/discord' }, 'https://evil.example'), env, fakeDiscord)).status, 403);
  assert.equal((await handle(req({ code: 'good', redirectUri: 'https://evil.example/auth/discord' }), env, fakeDiscord)).status, 400);
  const notSetUp = await handle(req({ code: 'good', redirectUri: 'https://i-love-jvo.web.app/auth/discord' }), { ...env, DISCORD_CLIENT_SECRET: '' }, fakeDiscord);
  assert.equal(notSetUp.status, 500);
});
