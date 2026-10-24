// A small Firestore client over the REST API (no extra packages).
// The bot signs in with its own email/password Firebase account; firestore.rules only lets that
// account (listed in /pickupBots) write the pickup collections, so its password can't touch
// anything else on the site.
//
// Times: numbers in fields whose name ends in "At" (createdAt, updatedAt...) are stored as
// Firestore timestamps and read back as milliseconds.

export function toValue(value, key = '') {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (key.endsWith('At') && Number.isFinite(value)) return { timestampValue: new Date(value).toISOString() };
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map((v) => toValue(v)) } };
  if (typeof value === 'object') return { mapValue: { fields: toFields(value) } };
  throw new TypeError(`Can't store a ${typeof value} in Firestore`);
}

export function toFields(obj) {
  const fields = {};
  for (const [key, value] of Object.entries(obj)) if (value !== undefined) fields[key] = toValue(value, key);
  return fields;
}

export function fromValue(v) {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return Date.parse(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields ?? {});
  return null;
}

export function fromFields(fields = {}) {
  const out = {};
  for (const [key, value] of Object.entries(fields)) out[key] = fromValue(value);
  return out;
}

// Reads the site's public collections (teams, players) with no sign-in at all: the rules make
// them public. Used for club roles.
export class SiteReader {
  constructor({ projectId, emulator = null, fetchFn = globalThis.fetch }) {
    this.fetchFn = fetchFn;
    this.base = `${emulator ? `${emulator.firestore}/v1/` : 'https://firestore.googleapis.com/v1/'}projects/${projectId}/databases/(default)/documents`;
  }

  async call(method, url, body) {
    const res = await this.fetchFn(url, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Reading the site failed (${res.status}): ${data.error?.message ?? data[0]?.error?.message ?? ''}`);
    return data;
  }

  async list(collection) {
    const out = [];
    let pageToken = '';
    do {
      const page = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
      const data = await this.call('GET', `${this.base}/${collection}?pageSize=300${page}`);
      for (const d of data.documents ?? []) out.push({ id: d.name.split('/').pop(), data: fromFields(d.fields) });
      pageToken = data.nextPageToken;
    } while (pageToken);
    return out;
  }

  // Documents where `field` == `value` (e.g. published events).
  async query(collection, field, value) {
    const rows = await this.call('POST', `${this.base}:runQuery`, {
      structuredQuery: { from: [{ collectionId: collection }], where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: toValue(value) } } },
    });
    return rows.filter((r) => r.document).map((r) => ({ id: r.document.name.split('/').pop(), data: fromFields(r.document.fields) }));
  }

  // Documents saved after `ms` (every site save stamps updatedAt).
  async changedSince(collection, ms) {
    const rows = await this.call('POST', `${this.base}:runQuery`, {
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: { fieldFilter: { field: { fieldPath: 'updatedAt' }, op: 'GREATER_THAN', value: { timestampValue: new Date(ms).toISOString() } } },
      },
    });
    return rows.filter((r) => r.document).map((r) => ({ id: r.document.name.split('/').pop(), data: fromFields(r.document.fields) }));
  }
}

export class FirestoreRest {
  // emulator: { firestore: 'http://127.0.0.1:8080', auth: 'http://127.0.0.1:9099' } or null
  constructor({ projectId, apiKey, email, password, emulator = null, fetchFn = globalThis.fetch }) {
    Object.assign(this, { projectId, apiKey, email, password, emulator, fetchFn });
    this.docsBase = emulator ? `${emulator.firestore}/v1/` : 'https://firestore.googleapis.com/v1/';
    this.authBase = emulator ? `${emulator.auth}/identitytoolkit.googleapis.com/v1/` : 'https://identitytoolkit.googleapis.com/v1/';
    this.root = `projects/${projectId}/databases/(default)/documents`;
    this.idToken = null;
    this.expires = 0;
    this.uid = null;
  }

  async authCall(action, body) {
    const res = await this.fetchFn(`${this.authBase}accounts:${action}?key=${encodeURIComponent(this.apiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, returnSecureToken: true }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  }

  async signIn() {
    const { ok, data } = await this.authCall('signInWithPassword', { email: this.email, password: this.password });
    if (!ok) {
      const why = data.error?.message ?? 'no answer';
      throw new Error(`Firebase sign-in for ${this.email} failed (${why}). Check FIREBASE_BOT_EMAIL / FIREBASE_BOT_PASSWORD (BOT-SETUP.md, Part 5).`);
    }
    this.idToken = data.idToken;
    this.uid = data.localId;
    // Tokens last an hour; get a new one 5 minutes early.
    this.expires = Date.now() + (Number(data.expiresIn ?? 3600) - 300) * 1000;
    return this.uid;
  }

  async token() {
    if (!this.idToken || Date.now() > this.expires) await this.signIn();
    return this.idToken;
  }

  async call(method, url, body, { allow404 = false, retried = false } = {}) {
    const res = await this.fetchFn(url, {
      method,
      headers: { authorization: `Bearer ${await this.token()}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (allow404 && res.status === 404) return null;
    if (res.status === 401 && !retried) {
      this.idToken = null;
      return this.call(method, url, body, { allow404, retried: true });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const hint = res.status === 403 ? ' (is the bot listed in pickupBots, and are the latest firestore.rules deployed?)' : '';
      throw new Error(`Firestore ${method} failed (${res.status}): ${data.error?.message ?? data[0]?.error?.message ?? ''}${hint}`);
    }
    return data;
  }

  async get(path) {
    const doc = await this.call('GET', `${this.docsBase}${this.root}/${path}`, undefined, { allow404: true });
    return doc ? fromFields(doc.fields) : null;
  }

  async list(collection) {
    const out = [];
    let pageToken = '';
    do {
      const page = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
      const data = await this.call('GET', `${this.docsBase}${this.root}/${collection}?pageSize=300${page}`);
      for (const d of data.documents ?? []) out.push({ id: d.name.split('/').pop(), data: fromFields(d.fields) });
      pageToken = data.nextPageToken;
    } while (pageToken);
    return out;
  }

  // Documents in `collection` where `field` == `value`.
  async query(collection, field, value) {
    const rows = await this.call('POST', `${this.docsBase}${this.root}:runQuery`, {
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: toValue(value) } },
      },
    });
    return rows.filter((r) => r.document).map((r) => ({ id: r.document.name.split('/').pop(), data: fromFields(r.document.fields) }));
  }

  // Several writes that all happen or none do.
  //   writes: [{ path: 'pickupGames/g1', data: {...}, mask?: ['field'], mustNotExist?: true, serverTime?: ['updatedAt'] }
  //            or { delete: 'pickupSignups/123' }]
  // Without `mask` the whole document is replaced; with it, only those fields change.
  // serverTime: fields set to the server's clock as it saves (the site's rules check updatedAt that way).
  async commit(writes) {
    return this.call('POST', `${this.docsBase}${this.root}:commit`, {
      writes: writes.map((w) => (w.delete ? { delete: `${this.root}/${w.delete}` } : {
        update: { name: `${this.root}/${w.path}`, fields: toFields(w.data) },
        ...(w.mask ? { updateMask: { fieldPaths: w.mask } } : {}),
        ...(w.mustNotExist ? { currentDocument: { exists: false } } : {}),
        ...(w.serverTime?.length ? { updateTransforms: w.serverTime.map((fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })) } : {}),
      })),
    });
  }

  // Uploads a file to Firebase Storage (storage.rules decides; the bot may only add match
  // screenshots). bucket: e.g. 'i-love-jvo.firebasestorage.app'. Returns the path.
  async upload(bucket, path, data, contentType) {
    const host = this.emulator?.storage ?? 'https://firebasestorage.googleapis.com';
    const url = `${host}/v0/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(path)}`;
    const send = async () => this.fetchFn(url, {
      method: 'POST',
      headers: { authorization: `Firebase ${await this.token()}`, 'content-type': contentType },
      body: data,
    });
    let res = await send();
    if (res.status === 401) {
      this.idToken = null;
      res = await send();
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`Storage upload failed (${res.status}): ${body.error?.message ?? ''}${res.status === 403 ? ' (are the latest storage.rules deployed?)' : ''}`);
    }
    return path;
  }

  // Deletes a file from Firebase Storage (storage.rules decides). A file already gone is fine.
  async removeFile(bucket, path) {
    const host = this.emulator?.storage ?? 'https://firebasestorage.googleapis.com';
    const res = await this.fetchFn(`${host}/v0/b/${bucket}/o/${encodeURIComponent(path)}`, {
      method: 'DELETE', headers: { authorization: `Firebase ${await this.token()}` },
    });
    if (!res.ok && res.status !== 404) throw new Error(`Storage delete failed (${res.status})`);
  }

  // Emulator only: create the bot account and list it in /pickupBots (the "owner" key skips the
  // rules, which only works on the emulator), so local testing needs no console steps.
  async bootstrapEmulator() {
    if (!this.emulator) throw new Error('bootstrapEmulator is for the emulator only');
    const made = await this.authCall('signUp', { email: this.email, password: this.password });
    if (!made.ok && made.data.error?.message !== 'EMAIL_EXISTS') {
      throw new Error(`Couldn't create the bot account in the Auth emulator: ${made.data.error?.message}`);
    }
    const uid = await this.signIn();
    const res = await this.fetchFn(`${this.docsBase}${this.root}/pickupBots/${uid}`, {
      method: 'PATCH',
      headers: { authorization: 'Bearer owner', 'content-type': 'application/json' },
      body: JSON.stringify({ fields: toFields({ name: 'Pickup bot (emulator)' }) }),
    });
    if (!res.ok) throw new Error(`Couldn't list the bot in pickupBots on the emulator (${res.status})`);
    return uid;
  }
}
