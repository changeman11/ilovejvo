// Profile images (team logos, player pictures, banners, page backgrounds), stored in
// Cloudflare Workers KV (free plan: 1 GB, no card). GIFs allowed.
//
//   GET    /media/{teams|players}/{id}/{kind}/{file}   anyone: the image
//   PUT    same path, body = image bytes                 the team's manager, the player, or an admin
//   DELETE same path                                     the same people
//
// Who's asking is proven with their Firebase sign-in token (checked against Google's keys),
// and whose profile it is comes from the database itself (Firestore), read with their own token.
// Admins: password sign-in AND listed in /admins, the same test as the database rules.

const KINDS = { teams: ['logo', 'banner', 'background'], players: ['avatar', 'banner', 'background'] };
const MB = 1024 * 1024;
export const MAX_BYTES = { logo: 2 * MB, avatar: 2 * MB, banner: 4 * MB, background: 6 * MB };
const TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const GOOGLE_KEYS = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

// "/media/teams/abc/logo/x1.gif" -> { owner, id, kind, ext, key } or null
export function parseMediaPath(pathname) {
  const m = /^\/media\/(teams|players)\/([A-Za-z0-9_-]{1,80})\/([a-z]+)\/([A-Za-z0-9_-]{1,40})\.(png|jpg|webp|gif)$/.exec(pathname);
  if (!m || !KINDS[m[1]].includes(m[3])) return null;
  return { owner: m[1], id: m[2], kind: m[3], ext: m[5], key: `${m[1]}/${m[2]}/${m[3]}/${m[4]}.${m[5]}` };
}

// What the bytes actually are (so nothing but real images can be stored).
export function sniffImage(bytes) {
  const b = new Uint8Array(bytes.slice(0, 12));
  const ascii = (from, to) => String.fromCharCode(...b.slice(from, to));
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (ascii(0, 4) === 'GIF8') return 'gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  return null;
}

const decodePart = (part) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))));
const b64urlBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

let keyCache = { keys: null, until: 0 };
async function googleKeys(fetchImpl) {
  if (keyCache.keys && Date.now() < keyCache.until) return keyCache.keys;
  const res = await fetchImpl(GOOGLE_KEYS);
  if (!res.ok) throw new Error('keys');
  const { keys } = await res.json();
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('Cache-Control') ?? '')?.[1] ?? 3600);
  keyCache = { keys, until: Date.now() + maxAge * 1000 };
  return keys;
}
export const resetKeyCache = () => { keyCache = { keys: null, until: 0 }; };

// Checks a Firebase sign-in (ID) token. Returns { uid, provider } or null.
// DEV_MODE (this computer only): the Auth emulator's tokens are unsigned, so only the claims are checked.
export async function verifyIdToken(token, env, fetchImpl = fetch, now = Math.floor(Date.now() / 1000)) {
  try {
    const [h, p, s] = String(token).split('.');
    const header = decodePart(h);
    const payload = decodePart(p);
    if (env.DEV_MODE !== '1') {
      if (header.alg !== 'RS256') return null;
      const jwk = (await googleKeys(fetchImpl)).find((k) => k.kid === header.kid);
      if (!jwk) return null;
      const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(s), new TextEncoder().encode(`${h}.${p}`));
      if (!ok) return null;
    }
    const project = env.FIREBASE_PROJECT_ID;
    if (payload.aud !== project || payload.iss !== `https://securetoken.google.com/${project}`) return null;
    if (!(payload.exp > now) || payload.iat > now + 60 || !payload.sub) return null;
    return { uid: payload.sub, provider: payload.firebase?.sign_in_provider ?? null };
  } catch {
    return null;
  }
}

// Reads one database document's fields with the person's own token (the database rules apply).
async function readDoc(path, token, env, fetchImpl) {
  const base = env.DEV_MODE === '1' ? (env.FIRESTORE_EMULATOR ?? 'http://127.0.0.1:8080') : 'https://firestore.googleapis.com';
  const res = await fetchImpl(`${base}/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return (await res.json()).fields ?? {};
}

async function mayChange(target, user, token, env, fetchImpl) {
  const doc = await readDoc(`${target.owner}/${target.id}`, token, env, fetchImpl);
  const field = target.owner === 'teams' ? 'managerUid' : 'uid';
  if (doc?.[field]?.stringValue === user.uid) return true;
  if (user.provider !== 'password') return false;
  return Boolean(await readDoc(`admins/${user.uid}`, token, env, fetchImpl));
}

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'",
};

// Returns a Response, or null if this isn't a /media request.
export async function handleMedia(request, env, { origin, json, fetchImpl = fetch }) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/media/')) return null;
  const target = parseMediaPath(url.pathname);
  if (!target) return json({ error: 'Not found' }, 404, origin);
  if (!env.MEDIA) return json({ error: 'Image storage isn’t set up yet.' }, 500, origin);

  if (request.method === 'GET' || request.method === 'HEAD') {
    const { value, metadata } = await env.MEDIA.getWithMetadata(target.key, { type: 'arrayBuffer', cacheTtl: 86400 });
    if (!value) return new Response('Not found', { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });
    return new Response(request.method === 'HEAD' ? null : value, {
      headers: {
        'Content-Type': metadata?.type ?? TYPES[target.ext],
        'Cache-Control': 'public, max-age=31536000, immutable', // every upload has its own name
        'Access-Control-Allow-Origin': '*',
        ...securityHeaders,
      },
    });
  }

  if (request.method !== 'PUT' && request.method !== 'DELETE') return json({ error: 'Not allowed' }, 405, origin);
  if (!origin) return json({ error: 'This site isn’t allowed to upload.' }, 403, null);
  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const user = await verifyIdToken(token, env, fetchImpl);
  if (!user) return json({ error: 'Please sign in again.' }, 401, origin);
  if (!(await mayChange(target, user, token, env, fetchImpl))) return json({ error: 'You can only change your own profile.' }, 403, origin);

  if (request.method === 'DELETE') {
    await env.MEDIA.delete(target.key);
    return json({ ok: true }, 200, origin);
  }

  const declared = (request.headers.get('Content-Type') ?? '').split(';')[0].trim();
  if (declared !== TYPES[target.ext]) return json({ error: 'Use a PNG, JPG, WebP or GIF image.' }, 415, origin);
  const length = Number(request.headers.get('Content-Length') ?? 0);
  if (length > MAX_BYTES[target.kind]) return json({ error: `That file is too big (max ${MAX_BYTES[target.kind] / MB} MB).` }, 413, origin);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0) return json({ error: 'That file is empty.' }, 400, origin);
  if (bytes.byteLength > MAX_BYTES[target.kind]) return json({ error: `That file is too big (max ${MAX_BYTES[target.kind] / MB} MB).` }, 413, origin);
  if (sniffImage(bytes) !== target.ext) return json({ error: 'That file isn’t a PNG, JPG, WebP or GIF image.' }, 415, origin);

  await env.MEDIA.put(target.key, bytes, { metadata: { type: TYPES[target.ext], by: user.uid, at: Date.now() } });
  return json({ path: target.key }, 201, origin);
}
