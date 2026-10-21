// I<3JVO Worker (Cloudflare, free plan): Discord sign-in and profile images.
//
// Discord sign-in: the website sends the one-time code Discord gives after a player approves sign-in.
// This Worker swaps it for the player's Discord identity (using the Discord client secret,
// which only lives here) and returns a Firebase sign-in token for uid "discord:<id>".
//
// Profile images: /media/... (see media.js), stored in Workers KV (binding MEDIA).
//
// Settings (wrangler.toml [vars]):  DISCORD_CLIENT_ID, ALLOWED_ORIGINS, FIREBASE_PROJECT_ID
// Secrets (`wrangler secret put`):   DISCORD_CLIENT_SECRET, FIREBASE_SERVICE_ACCOUNT (the key JSON)

import { handleMedia } from './media.js';

const FIREBASE_AUDIENCE = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlText = (text) => b64url(new TextEncoder().encode(text));

function pemToDer(pem) {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const raw = atob(body);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

// A Firebase custom token: a JWT signed (RS256) with the service account's private key.
export async function createCustomToken({ clientEmail, privateKey }, uid, claims, now = Math.floor(Date.now() / 1000)) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iss: clientEmail, sub: clientEmail, aud: FIREBASE_AUDIENCE, iat: now, exp: now + 3600, uid, claims };
  const unsigned = `${b64urlText(JSON.stringify(header))}.${b64urlText(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(privateKey), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64url(signature)}`;
}

export function allowedOrigin(origin, env) {
  const list = String(env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.includes(origin) ? origin : null;
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    },
  });
}

export async function handle(request, env, fetchImpl = fetch) {
  const origin = allowedOrigin(request.headers.get('Origin') ?? '', env);

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: origin ? 204 : 403,
      headers: origin ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      } : {},
    });
  }

  // Profile images (see media.js).
  const media = await handleMedia(request, env, { origin, json, fetchImpl });
  if (media) return media;
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/discord') return json({ error: 'Not found' }, 404, origin);
  if (!origin) return json({ error: 'This site isn’t allowed to use sign-in.' }, 403, null);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Bad request.' }, 400, origin);
  }
  const { code, redirectUri } = body ?? {};
  // The redirect must be this same site's /auth/discord page.
  if (typeof code !== 'string' || !code || redirectUri !== `${origin}/auth/discord`) {
    return json({ error: 'Bad sign-in request.' }, 400, origin);
  }
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !env.FIREBASE_SERVICE_ACCOUNT) {
    return json({ error: 'Discord sign-in isn’t set up yet.' }, 500, origin);
  }

  // 1. Swap the one-time code for a Discord access token.
  const tokenRes = await fetchImpl('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) return json({ error: 'Discord didn’t accept the sign-in. Please try again.' }, 401, origin);
  const { access_token: accessToken } = await tokenRes.json();

  // 2. Who is this?
  const userRes = await fetchImpl('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!userRes.ok) return json({ error: 'Couldn’t reach Discord. Please try again.' }, 502, origin);
  const user = await userRes.json();

  // 3. Firebase sign-in token for "discord:<id>". The claims are readable by the security rules.
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const name = user.global_name || user.username;
  const avatarUrl = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : null;
  const token = await createCustomToken(
    { clientEmail: sa.client_email, privateKey: sa.private_key },
    `discord:${user.id}`,
    { discordId: user.id, discordName: name },
  );
  return json({ token, profile: { discordId: user.id, name, avatarUrl } }, 200, origin);
}

export default {
  fetch(request, env) {
    return handle(request, env).catch((err) => {
      console.error(err);
      return json({ error: 'Something went wrong. Please try again.' }, 500, allowedOrigin(request.headers.get('Origin') ?? '', env));
    });
  },
};
