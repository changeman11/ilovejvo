var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/media.js
var KINDS = { teams: ["logo", "banner", "background"], players: ["avatar", "banner", "background"] };
var MB = 1024 * 1024;
var MAX_BYTES = { logo: 2 * MB, avatar: 2 * MB, banner: 4 * MB, background: 6 * MB };
var TYPES = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
var GOOGLE_KEYS = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
function parseMediaPath(pathname) {
  const m = /^\/media\/(teams|players)\/([A-Za-z0-9_-]{1,80})\/([a-z]+)\/([A-Za-z0-9_-]{1,40})\.(png|jpg|webp|gif)$/.exec(pathname);
  if (!m || !KINDS[m[1]].includes(m[3])) return null;
  return { owner: m[1], id: m[2], kind: m[3], ext: m[5], key: `${m[1]}/${m[2]}/${m[3]}/${m[4]}.${m[5]}` };
}
__name(parseMediaPath, "parseMediaPath");
function sniffImage(bytes) {
  const b = new Uint8Array(bytes.slice(0, 12));
  const ascii = /* @__PURE__ */ __name((from, to) => String.fromCharCode(...b.slice(from, to)), "ascii");
  if (b[0] === 137 && ascii(1, 4) === "PNG") return "png";
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return "jpg";
  if (ascii(0, 4) === "GIF8") return "gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  return null;
}
__name(sniffImage, "sniffImage");
var decodePart = /* @__PURE__ */ __name((part) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)))), "decodePart");
var b64urlBytes = /* @__PURE__ */ __name((s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)), "b64urlBytes");
var keyCache = { keys: null, until: 0 };
async function googleKeys(fetchImpl) {
  if (keyCache.keys && Date.now() < keyCache.until) return keyCache.keys;
  const res = await fetchImpl(GOOGLE_KEYS);
  if (!res.ok) throw new Error("keys");
  const { keys } = await res.json();
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("Cache-Control") ?? "")?.[1] ?? 3600);
  keyCache = { keys, until: Date.now() + maxAge * 1e3 };
  return keys;
}
__name(googleKeys, "googleKeys");
async function verifyIdToken(token, env, fetchImpl = fetch, now = Math.floor(Date.now() / 1e3)) {
  try {
    const [h, p, s] = String(token).split(".");
    const header = decodePart(h);
    const payload = decodePart(p);
    if (env.DEV_MODE !== "1") {
      if (header.alg !== "RS256") return null;
      const jwk = (await googleKeys(fetchImpl)).find((k) => k.kid === header.kid);
      if (!jwk) return null;
      const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
      const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(s), new TextEncoder().encode(`${h}.${p}`));
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
__name(verifyIdToken, "verifyIdToken");
async function readDoc(path, token, env, fetchImpl) {
  const base = env.DEV_MODE === "1" ? env.FIRESTORE_EMULATOR ?? "http://127.0.0.1:8080" : "https://firestore.googleapis.com";
  const res = await fetchImpl(`${base}/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;
  return (await res.json()).fields ?? {};
}
__name(readDoc, "readDoc");
async function mayChange(target, user, token, env, fetchImpl) {
  const doc = await readDoc(`${target.owner}/${target.id}`, token, env, fetchImpl);
  const field = target.owner === "teams" ? "managerUid" : "uid";
  if (doc?.[field]?.stringValue === user.uid) return true;
  if (user.provider !== "password") return false;
  return Boolean(await readDoc(`admins/${user.uid}`, token, env, fetchImpl));
}
__name(mayChange, "mayChange");
var securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'"
};
async function handleMedia(request, env, { origin, json: json2, fetchImpl = fetch }) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/media/")) return null;
  const target = parseMediaPath(url.pathname);
  if (!target) return json2({ error: "Not found" }, 404, origin);
  if (!env.MEDIA) return json2({ error: "Image storage isn\u2019t set up yet." }, 500, origin);
  if (request.method === "GET" || request.method === "HEAD") {
    const { value, metadata } = await env.MEDIA.getWithMetadata(target.key, { type: "arrayBuffer", cacheTtl: 86400 });
    if (!value) return new Response("Not found", { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });
    return new Response(request.method === "HEAD" ? null : value, {
      headers: {
        "Content-Type": metadata?.type ?? TYPES[target.ext],
        "Cache-Control": "public, max-age=31536000, immutable",
        // every upload has its own name
        "Access-Control-Allow-Origin": "*",
        ...securityHeaders
      }
    });
  }
  if (request.method !== "PUT" && request.method !== "DELETE") return json2({ error: "Not allowed" }, 405, origin);
  if (!origin) return json2({ error: "This site isn\u2019t allowed to upload." }, 403, null);
  const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const user = await verifyIdToken(token, env, fetchImpl);
  if (!user) return json2({ error: "Please sign in again." }, 401, origin);
  if (!await mayChange(target, user, token, env, fetchImpl)) return json2({ error: "You can only change your own profile." }, 403, origin);
  if (request.method === "DELETE") {
    await env.MEDIA.delete(target.key);
    return json2({ ok: true }, 200, origin);
  }
  const declared = (request.headers.get("Content-Type") ?? "").split(";")[0].trim();
  if (declared !== TYPES[target.ext]) return json2({ error: "Use a PNG, JPG, WebP or GIF image." }, 415, origin);
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (length > MAX_BYTES[target.kind]) return json2({ error: `That file is too big (max ${MAX_BYTES[target.kind] / MB} MB).` }, 413, origin);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0) return json2({ error: "That file is empty." }, 400, origin);
  if (bytes.byteLength > MAX_BYTES[target.kind]) return json2({ error: `That file is too big (max ${MAX_BYTES[target.kind] / MB} MB).` }, 413, origin);
  if (sniffImage(bytes) !== target.ext) return json2({ error: "That file isn\u2019t a PNG, JPG, WebP or GIF image." }, 415, origin);
  await env.MEDIA.put(target.key, bytes, { metadata: { type: TYPES[target.ext], by: user.uid, at: Date.now() } });
  return json2({ path: target.key }, 201, origin);
}
__name(handleMedia, "handleMedia");

// src/index.js
var FIREBASE_AUDIENCE = "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit";
var b64url = /* @__PURE__ */ __name((bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""), "b64url");
var b64urlText = /* @__PURE__ */ __name((text) => b64url(new TextEncoder().encode(text)), "b64urlText");
function pemToDer(pem) {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const raw = atob(body);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}
__name(pemToDer, "pemToDer");
async function createCustomToken({ clientEmail, privateKey }, uid, claims, now = Math.floor(Date.now() / 1e3)) {
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iss: clientEmail, sub: clientEmail, aud: FIREBASE_AUDIENCE, iat: now, exp: now + 3600, uid, claims };
  const unsigned = `${b64urlText(JSON.stringify(header))}.${b64urlText(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(privateKey), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64url(signature)}`;
}
__name(createCustomToken, "createCustomToken");
function allowedOrigin(origin, env) {
  const list = String(env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.includes(origin) ? origin : null;
}
__name(allowedOrigin, "allowedOrigin");
function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}
    }
  });
}
__name(json, "json");
async function handle(request, env, fetchImpl = fetch) {
  const origin = allowedOrigin(request.headers.get("Origin") ?? "", env);
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: origin ? 204 : 403,
      headers: origin ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin"
      } : {}
    });
  }
  const media = await handleMedia(request, env, { origin, json, fetchImpl });
  if (media) return media;
  if (request.method !== "POST" || new URL(request.url).pathname !== "/discord") return json({ error: "Not found" }, 404, origin);
  if (!origin) return json({ error: "This site isn\u2019t allowed to use sign-in." }, 403, null);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Bad request." }, 400, origin);
  }
  const { code, redirectUri } = body ?? {};
  if (typeof code !== "string" || !code || redirectUri !== `${origin}/auth/discord`) {
    return json({ error: "Bad sign-in request." }, 400, origin);
  }
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !env.FIREBASE_SERVICE_ACCOUNT) {
    return json({ error: "Discord sign-in isn\u2019t set up yet." }, 500, origin);
  }
  const tokenRes = await fetchImpl("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri
    })
  });
  if (!tokenRes.ok) return json({ error: "Discord didn\u2019t accept the sign-in. Please try again." }, 401, origin);
  const { access_token: accessToken } = await tokenRes.json();
  const userRes = await fetchImpl("https://discord.com/api/users/@me", { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!userRes.ok) return json({ error: "Couldn\u2019t reach Discord. Please try again." }, 502, origin);
  const user = await userRes.json();
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const name = user.global_name || user.username;
  const avatarUrl = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : null;
  const token = await createCustomToken(
    { clientEmail: sa.client_email, privateKey: sa.private_key },
    `discord:${user.id}`,
    { discordId: user.id, discordName: name }
  );
  return json({ token, profile: { discordId: user.id, name, avatarUrl } }, 200, origin);
}
__name(handle, "handle");
var src_default = {
  fetch(request, env) {
    return handle(request, env).catch((err) => {
      console.error(err);
      return json({ error: "Something went wrong. Please try again." }, 500, allowedOrigin(request.headers.get("Origin") ?? "", env));
    });
  }
};

// ../../../../AppData/Local/npm-cache/_npx/78d01645d72bf3b7/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../AppData/Local/npm-cache/_npx/78d01645d72bf3b7/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-jzlomw/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../../../../AppData/Local/npm-cache/_npx/78d01645d72bf3b7/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-jzlomw/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  allowedOrigin,
  createCustomToken,
  middleware_loader_entry_default as default,
  handle
};
//# sourceMappingURL=index.js.map
