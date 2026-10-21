// Loads the sample season into the LOCAL Firestore emulator.
// It only ever talks to 127.0.0.1, so it can't touch a live Firebase project.
//
// Usage (with the emulator running in another terminal):  npm run seed

import { readFileSync } from 'node:fs';
import { buildSampleData } from './sample-season.mjs';

const projectId = JSON.parse(readFileSync(new URL('../.firebaserc', import.meta.url))).projects.default;
const host = `http://127.0.0.1:${JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url))).emulators.firestore.port}`;
const root = `projects/${projectId}/databases/(default)/documents`;
// "Bearer owner" is an emulator-only key that skips security rules. It does nothing on real Firebase.
const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer owner' };

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
    const res = await fetch(`${host}/v1/${root}:commit`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ writes: writes.slice(i, i + 400) }),
    });
    if (!res.ok) throw new Error(`Write failed (${res.status}): ${await res.text()}`);
  }
}

async function main() {
  try {
    await fetch(host);
  } catch {
    console.error(`\nCan't reach the Firestore emulator at ${host}.\nStart it first with:  npm run dev\n`);
    process.exit(1);
  }

  // Start from an empty database so re-running gives the same result.
  const wipe = await fetch(`${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, {
    method: 'DELETE',
    headers,
  });
  if (!wipe.ok) throw new Error(`Couldn't clear emulator: ${wipe.status}`);

  const d = buildSampleData();
  const writes = [];
  const put = (path, data) => writes.push({ update: { name: `${root}/${path}`, fields: encodeFields(data) } });

  put('settings/site', d.settings);
  // The emulator-only "Sign in as test admin" account. Real admins are added in the Firebase console.
  put('admins/discord:dev-admin', { name: 'Test Admin', addedAt: new Date() });
  for (const { id, ...t } of d.teams) put(`teams/${id}`, t);
  for (const { id, ...p } of d.players) put(`players/${id}`, p);
  for (const s of d.seasons) {
    put(`seasons/${s.id}`, s.season);
    for (const [teamId, r] of Object.entries(s.rosters)) put(`seasons/${s.id}/rosters/${teamId}`, r);
    for (const { id, ...f } of s.fixtures) put(`seasons/${s.id}/fixtures/${id}`, f);
    for (const [id, r] of Object.entries(s.results)) put(`seasons/${s.id}/results/${id}`, r);
  }

  await commit(writes);
  console.log(`Seeded ${d.teams.length} teams, ${d.players.length} players.`);
  for (const s of d.seasons) {
    console.log(`  ${s.season.name}: ${s.fixtures.length} fixtures, ${Object.keys(s.results).length} results`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
