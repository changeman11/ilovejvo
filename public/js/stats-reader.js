// Reads end-of-match screenshots by itself, so staff only have to check the numbers.
//
// As soon as a match's score is in (statsStatus 'pending') and one of its votes has a screenshot
// (from the site or a Discord match thread), any admin browser that's open reads it in the
// background (ocr.js) and saves the reading on the result as `statsDraft`:
//   { shot: path, readAt, by, rows: [{ side, nameText, name, playerId, stats: { pts: { value, sure } | null } }] }
//   or { shot, readAt, by, error } if it couldn't be read, or { shot, reading: true, at, by } while one
//   admin's browser is on it (others leave it for 3 minutes).
// The admin result page then opens with the stats table already filled in. Saving the result
// replaces the whole document, so the draft goes with it.
// Nothing is stored that an admin hasn't checked: playerStats only change on "Use these stats" + save.

import { currentAdmin } from './auth.js';
import { loadAllBundles, onDataChange } from './data.js';
import { commit } from './writes.js';
import { mediaUrl } from './media.js';
import { matchNames } from './rules/endscreen.js';

const CLAIM_MS = 3 * 60 * 1000;
const RETRY_MS = 15 * 60 * 1000; // a failed read is tried again after this
let busy = false;
let again = false;
const tried = new Set(); // "<event>/<fixture>/<shot>" read (or failed) in this browser already

// Players a match could involve: both squads, both event rosters, anyone with a stat line already.
export function candidatesFor(b, fixture, result = null) {
  const ids = new Set();
  for (const teamId of [fixture.homeTeamId, fixture.awayTeamId]) {
    for (const p of Object.values(b.playersById)) if (p.teamId === teamId) ids.add(p.id);
    for (const pid of b.rosters[teamId]?.playerIds ?? []) ids.add(pid);
  }
  for (const pid of Object.keys(result?.playerStats ?? {})) ids.add(pid);
  return [...ids].map((id) => b.playersById[id]).filter(Boolean);
}

// The screenshot to read for a match: from the votes that confirmed the score first, newest first.
export function shotFor(b, fixture, result) {
  const votes = (b.submissions ?? [])
    .filter((v) => v.fixtureId === fixture.id && v.screenshotPaths?.length)
    .sort((x, y) => Number((result?.confirmedBy ?? []).includes(y.id)) - Number((result?.confirmedBy ?? []).includes(x.id)) || (y.updatedAt ?? 0) - (x.updatedAt ?? 0));
  return votes[0]?.screenshotPaths[0] ?? null;
}

// Reads one screenshot (a path, a URL or a Blob) and matches the names to players.
export async function readMatchShot(b, fixture, source, { result = null, onProgress } = {}) {
  const { readEndScreen } = await import('./ocr.js');
  let blob = source;
  if (!(source instanceof Blob)) {
    // cache: 'reload' = always a fresh copy: a copy the browser kept from before Storage allowed
    // downloads (storage-cors.json) would still be refused.
    const res = await fetch(source.startsWith('http') ? source : mediaUrl(source), { cache: 'reload' }).catch(() => null);
    if (!res?.ok) throw new Error('Couldn’t download that screenshot here. Open it (click the picture), save it, then use “Read a screenshot from this computer…”.');
    blob = await res.blob();
  }
  const out = await readEndScreen(blob, { onProgress });
  const rows = out.panels.flatMap((panel, pi) => panel.rows.map((row) => ({ ...row, side: pi === 0 ? 'left' : 'right' })));
  const candidates = candidatesFor(b, fixture, result).map((p) => ({ id: p.id, names: [p.displayName, ...(p.gameNames ?? [])] }));
  const matched = matchNames(rows.map((r) => r.name), candidates);
  rows.forEach((r, i) => { r.playerId = matched[i].playerId ?? null; });
  return rows;
}

// Matches whose score is in, with a screenshot nobody has read yet.
function waiting(bundles, now) {
  const out = [];
  for (const b of bundles) {
    for (const f of b.fixtures) {
      const result = b.results[f.id];
      if (f.virtual || result?.statsStatus !== 'pending') continue;
      const shot = shotFor(b, f, result);
      if (!shot) continue;
      const d = result.statsDraft;
      if (d?.shot === shot && d.rows) continue; // already read
      if (d?.shot === shot && d.error && now - (d.readAt ?? 0) < RETRY_MS) continue; // failed: try again later
      if (d?.shot === shot && d.reading && now - (d.at ?? 0) < CLAIM_MS) continue; // another admin is on it
      if (tried.has(`${b.event.id}/${f.id}/${shot}/${d?.readAt ?? ''}`)) continue;
      out.push({ b, f, result, shot });
    }
  }
  return out;
}

const save = (uid, b, f, result, statsDraft) => commit(uid, [{
  type: 'update', path: `events/${b.event.id}/results/${f.id}`, before: result, data: { statsDraft },
}], { admin: true });

// Reads everything that's waiting, one screenshot at a time.
export async function readWaitingStats() {
  if (busy) { again = true; return; }
  busy = true;
  try {
    do {
      again = false;
      const { user, admin } = await currentAdmin().catch(() => ({}));
      if (!admin) return;
      const bundles = await loadAllBundles({ includeDrafts: true }).catch(() => []);
      for (const { b, f, result, shot } of waiting(bundles, Date.now())) {
        tried.add(`${b.event.id}/${f.id}/${shot}/${result.statsDraft?.readAt ?? ''}`);
        try {
          await save(user.uid, b, f, result, { shot, reading: true, at: Date.now(), by: user.uid });
        } catch (err) {
          console.warn('Stats reader: couldn’t claim', f.id, err);
          continue; // e.g. the result was just saved by someone else
        }
        let draft;
        try {
          const rows = await readMatchShot(b, f, shot, { result });
          draft = { shot, readAt: Date.now(), by: user.uid, rows };
        } catch (err) {
          console.warn('Stats reader:', f.id, err);
          draft = { shot, readAt: Date.now(), by: user.uid, error: String(err.message ?? err).slice(0, 300) };
        }
        // Save on top of the latest copy (it may have changed while reading).
        const fresh = (await loadAllBundles({ includeDrafts: true }).catch(() => []))
          .find((x) => x.event.id === b.event.id)?.results[f.id];
        if (!fresh || fresh.statsStatus !== 'pending') continue; // an admin finished it meanwhile
        await save(user.uid, b, f, fresh, draft).catch((err) => console.warn('Stats reader: couldn’t save', f.id, err));
      }
    } while (again);
  } finally {
    busy = false;
  }
}

// Started once by app.js: looks again whenever the data changes.
export function startStatsReader() {
  onDataChange(() => { readWaitingStats(); });
  setInterval(() => { if (!document.hidden) readWaitingStats(); }, 5 * 60 * 1000); // retries failed reads
  readWaitingStats();
}
