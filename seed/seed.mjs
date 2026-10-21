// Loads sample data into the LOCAL Firebase emulators, and creates a local test admin login.
// It only ever talks to 127.0.0.1, so it can't touch a live Firebase project.
//
// Usage (with the emulators running in another terminal):  npm run seed
//
// Local test admin: username "admin", password "jvo-local-admin" (emulator only).

import { readFileSync } from 'node:fs';
import { buildSampleData } from './sample-data.mjs';

const firebaseJson = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url)));
const projectId = JSON.parse(readFileSync(new URL('../.firebaserc', import.meta.url))).projects.default;
const host = `http://127.0.0.1:${firebaseJson.emulators.firestore.port}`;
const authHost = `http://127.0.0.1:${firebaseJson.emulators.auth.port}`;
const root = `projects/${projectId}/databases/(default)/documents`;
// "Bearer owner" is an emulator-only key that skips security rules. It does nothing on real Firebase.
const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer owner' };

const ADMIN = { email: 'admin@users.ilovejvo.com', password: 'jvo-local-admin', name: 'Test Admin' };

// Converts a plain JS value to Firestore's REST format.
function encode(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  switch (typeof value) {
    case 'string': return { stringValue: value };
    case 'boolean': return { booleanValue: value };
    case 'number': return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    case 'object': return { mapValue: { fields: encodeFields(value) } };
    default: throw new Error(`Can't encode ${typeof value}`);
  }
}
function encodeFields(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, encode(v)]));
}

async function commit(writes) {
  for (let i = 0; i < writes.length; i += 400) {
    const res = await fetch(`${host}/v1/${root}:commit`, { method: 'POST', headers, body: JSON.stringify({ writes: writes.slice(i, i + 400) }) });
    if (!res.ok) throw new Error(`Write failed (${res.status}): ${await res.text()}`);
  }
}

// Creates the test admin in the Auth emulator and returns its uid.
async function createAdmin() {
  await fetch(`${authHost}/emulator/v1/projects/${projectId}/accounts`, { method: 'DELETE' });
  const res = await fetch(`${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN.email, password: ADMIN.password, returnSecureToken: true }),
  });
  if (!res.ok) throw new Error(`Couldn't create test admin (${res.status}): ${await res.text()}`);
  return (await res.json()).localId;
}

async function main() {
  try {
    await fetch(host);
  } catch {
    console.error(`\nCan't reach the Firestore emulator at ${host}.\nStart it first with:  npm run dev\n`);
    process.exit(1);
  }

  // Start from an empty database so re-running gives the same result.
  const wipe = await fetch(`${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE', headers });
  if (!wipe.ok) throw new Error(`Couldn't clear emulator: ${wipe.status}`);

  const adminUid = await createAdmin();
  const d = buildSampleData();
  const stamp = { updatedBy: 'seed', updatedAt: new Date() };
  const writes = [];
  const put = (path, data) => writes.push({ update: { name: `${root}/${path}`, fields: encodeFields({ ...data, ...stamp }) } });

  put(`admins/${adminUid}`, { name: ADMIN.name });
  for (const { id, ...t } of d.teams) put(`teams/${id}`, t);
  for (const { id, ...p } of d.players) put(`players/${id}`, p);
  for (const e of d.events) {
    put(`events/${e.id}`, { ...e.doc, createdAt: new Date(), createdBy: 'seed' });
    for (const { id, ...f } of e.fixtures) put(`events/${e.id}/fixtures/${id}`, f);
    for (const [id, r] of Object.entries(e.results)) put(`events/${e.id}/results/${id}`, r);
    for (const [teamId, r] of Object.entries(e.rosters)) put(`events/${e.id}/rosters/${teamId}`, r);
  }
  await commit(writes);

  console.log(`Seeded ${d.teams.length} teams, ${d.players.length} players, ${d.events.length} events:`);
  for (const e of d.events) {
    console.log(`  ${e.doc.title}${e.doc.published ? '' : ' (draft)'}: ${e.fixtures.length} fixtures, ${Object.keys(e.results).length} results`);
  }
  console.log('Local test admin: username "admin" (password in seed/seed.mjs).');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
