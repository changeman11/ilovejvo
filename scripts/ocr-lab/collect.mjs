// Stats reader lab, step 1: collect every match that has end-of-match screenshots, with the stats
// staff saved for it (a first guess at the right answers: they were confirmed quickly, so the lab
// checks them against the pictures before trusting them).
//
//   node scripts/ocr-lab/collect.mjs
//
// Reads the live site's public data (no sign-in) and writes, git-ignored:
//   ocr-lab/shots/<file>        the screenshots (originals as stored)
//   ocr-lab/matches.json        [{ eventId, fixtureId, home, away, statsStatus, shots: [file], saved: { playerId: { teamId, pts, ... } } }]
//   ocr-lab/players.json        { playerId: { name, gameNames, teamId, discordId } }
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'ocr-lab');
const PROJECT = 'i-love-jvo';
const BUCKET = 'i-love-jvo.firebasestorage.app';
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

function value(v) {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return Date.parse(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(value);
  if ('mapValue' in v) return fields(v.mapValue.fields ?? {});
  return null;
}
const fields = (f = {}) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, value(v)]));
const docs = (list) => (list ?? []).map((d) => ({ id: d.name.split('/').pop(), ...fields(d.fields) }));

async function list(path) {
  const out = [];
  let token = '';
  do {
    const res = await (await fetch(`${FS}/${path}?pageSize=300${token ? `&pageToken=${token}` : ''}`)).json();
    out.push(...docs(res.documents));
    token = res.nextPageToken ?? '';
  } while (token);
  return out;
}

mkdirSync(join(OUT, 'shots'), { recursive: true });
const rows = await (await fetch(`${FS}:runQuery`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'events' }], where: { fieldFilter: { field: { fieldPath: 'published' }, op: 'EQUAL', value: { booleanValue: true } } } } }),
})).json();
const events = rows.filter((r) => r.document).map((r) => ({ id: r.document.name.split('/').pop(), ...fields(r.document.fields) }));

const players = Object.fromEntries((await list('players')).map((p) => [p.id, { name: p.displayName, gameNames: p.gameNames ?? [], teamId: p.teamId ?? null, discordId: p.discordId ?? null }]));
const matches = [];
let downloaded = 0;
for (const e of events) {
  const [fixtures, results, subs] = await Promise.all([list(`events/${e.id}/fixtures`), list(`events/${e.id}/results`), list(`events/${e.id}/submissions`)]);
  const byId = Object.fromEntries(fixtures.map((f) => [f.id, f]));
  for (const r of results) {
    if (r.forfeit) continue;
    const f = byId[r.id];
    const paths = [...new Set([
      ...subs.filter((s) => s.fixtureId === r.id).flatMap((s) => s.screenshotPaths ?? []),
      ...(r.threadShots ?? []),
    ])];
    if (!paths.length) continue;
    const shots = [];
    for (const p of paths) {
      const file = p.replace(/\//g, '__');
      if (!existsSync(join(OUT, 'shots', file))) {
        const res = await fetch(`https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(p)}?alt=media`);
        if (!res.ok) { console.warn('could not download', p, res.status); continue; }
        writeFileSync(join(OUT, 'shots', file), Buffer.from(await res.arrayBuffer()));
        downloaded++;
      }
      shots.push(file);
    }
    matches.push({ eventId: e.id, event: e.title, fixtureId: r.id, home: f?.homeTeamId ?? null, away: f?.awayTeamId ?? null, statsStatus: r.statsStatus ?? null, sets: r.sets, shots, saved: r.playerStats ?? {} });
  }
}
writeFileSync(join(OUT, 'matches.json'), JSON.stringify(matches, null, 1));
writeFileSync(join(OUT, 'players.json'), JSON.stringify(players, null, 1));
const withStats = matches.filter((m) => Object.keys(m.saved).length);
console.log(`${matches.length} matches with screenshots (${withStats.length} with saved stats), ${matches.reduce((n, m) => n + m.shots.length, 0)} screenshots (${downloaded} downloaded now).`);
