// Reads data from Firestore and turns it into plain objects the pages can use.
// Dates become milliseconds so the rules engine never sees Firebase types.
// Everything is cached for the visit; admin pages ask for fresh copies.

import {
  doc, getDoc, getDocs, collection, query, where,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from './firebase.js';
import { DEFAULT_FORMAT, DEFAULT_STATS, DEFAULT_STANDINGS } from './rules/defaults.js';

export class NotFoundError extends Error {}

function plain(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  }
  return value;
}

const asObj = (d) => ({ id: d.id, ...plain(d.data()) });

async function getOne(path) {
  const snap = await getDoc(doc(db, path));
  return snap.exists() ? asObj(snap) : null;
}

async function getAll(path) {
  const snap = await getDocs(collection(db, path));
  return snap.docs.map(asObj);
}

// Caches a promise; drops it on failure so the next visit can retry.
const cache = new Map();
function cached(key, load) {
  if (!cache.has(key)) {
    const p = load();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return cache.get(key);
}

// Forget cached data after an admin change (or pass nothing to forget everything).
export function invalidate(prefix = '') {
  for (const key of [...cache.keys()]) if (key.startsWith(prefix)) cache.delete(key);
}

// ---------- Teams and players (shared by every event) ----------

export const loadTeams = ({ fresh = false } = {}) => {
  if (fresh) invalidate('teams');
  return cached('teams', () => getAll('teams'));
};
export const loadPlayers = ({ fresh = false } = {}) => {
  if (fresh) invalidate('players');
  return cached('players', () => getAll('players'));
};

// ---------- Events ----------

// Published events only: what the public may see.
export const loadPublicEvents = () =>
  cached('events:public', async () => {
    const snap = await getDocs(query(collection(db, 'events'), where('published', '==', true)));
    return snap.docs.map(asObj);
  });

// Every event including drafts (admins only; the rules refuse anyone else).
export async function loadAllEvents() {
  return getAll('events');
}

// The settings the scoring/stats engine needs, built from an event.
// (The engine was written for seasons; an event is shaped the same way.)
export function engineSeason(event) {
  return {
    id: event.id,
    name: event.title,
    status: event.status,
    format: { ...DEFAULT_FORMAT, ...(event.matchFormat ?? {}) },
    stats: event.stats ?? DEFAULT_STATS,
    standings: DEFAULT_STANDINGS,
    divisions: [{ id: 'main', teamIds: event.teamIds ?? [] }],
  };
}

// Everything one event's pages need.
// Returns { event, season, teams, teamsById, playersById, rosters, fixtures, results }
export function loadEventBundle(eventId, { fresh = false } = {}) {
  if (fresh) invalidate(`event:${eventId}`);
  return cached(`event:${eventId}`, async () => {
    let event;
    try {
      event = await getOne(`events/${eventId}`);
    } catch (err) {
      if (err.code === 'permission-denied') throw new NotFoundError('That event doesn’t exist');
      throw err;
    }
    if (!event) throw new NotFoundError('That event doesn’t exist');
    const base = `events/${eventId}`;
    const [teams, players, rosters, fixtures, results] = await Promise.all([
      loadTeams({ fresh }),
      loadPlayers({ fresh }),
      getAll(`${base}/rosters`),
      getAll(`${base}/fixtures`),
      getAll(`${base}/results`),
    ]);
    const teamIds = new Set(event.teamIds ?? []);
    return {
      event,
      season: engineSeason(event),
      teams: teams.filter((t) => teamIds.has(t.id)),
      teamsById: Object.fromEntries(teams.map((t) => [t.id, t])),
      playersById: Object.fromEntries(players.map((p) => [p.id, p])),
      rosters: Object.fromEntries(rosters.map((r) => [r.id, r])),
      // `round` keeps the engine's ordering for undated fixtures
      fixtures: fixtures.map((f) => ({ ...f, round: f.order ?? 0 })),
      results: Object.fromEntries(results.map((r) => [r.id, r])),
    };
  });
}

// Every published event's bundle (admins: every event), oldest event first.
// Used for site-wide fixtures, stats and player careers.
export async function loadAllBundles({ includeDrafts = false, fresh = false } = {}) {
  const events = includeDrafts ? await loadAllEvents() : await loadPublicEvents();
  const bundles = await Promise.all(events.map((e) => loadEventBundle(e.id, { fresh })));
  return bundles.sort((a, b) => (a.event.date ?? a.event.createdAt ?? 0) - (b.event.date ?? b.event.createdAt ?? 0));
}

// ---------- Players' own things (needs sign-in; the rules only return the player's own) ----------

async function queryAll(path, field, value) {
  const snap = await getDocs(query(collection(db, path), where(field, '==', value)));
  return snap.docs.map(asObj);
}

// Everything the "Me" page needs for a signed-in user.
export async function loadMe(uid) {
  const [people, offers, leaves, claim, sentOffers] = await Promise.all([
    loadPeople({ fresh: true }),
    queryAll('offers', 'playerUid', uid),
    queryAll('leaveRequests', 'uid', uid),
    getOne(`claims/${uid}`),
    queryAll('offers', 'fromUid', uid),
  ]);
  const player = people.players.find((p) => p.uid === uid) ?? null;
  const team = player?.teamId ? people.teamsById[player.teamId] ?? null : null;
  const pendingTeam = people.teams.find((t) => t.managerUid === uid && t.status === 'pending') ?? null;
  return { ...people, player, team, pendingTeam, offers, sentOffers, leaves, claim };
}

// Admin inbox: pending team registrations, leave requests and profile claims.
export async function loadRequests() {
  const [people, leaves, claims] = await Promise.all([
    loadPeople({ fresh: true }),
    queryAll('leaveRequests', 'status', 'pending'),
    queryAll('claims', 'status', 'pending'),
  ]);
  return { ...people, pendingTeams: people.teams.filter((t) => t.status === 'pending'), leaves, claims };
}

// A team counts as real once approved (older teams have no status = approved).
export const isApprovedTeam = (t) => Boolean(t) && (t.status ?? 'approved') === 'approved';

// Teams and players by id, without loading any event.
export async function loadPeople({ fresh = false } = {}) {
  const [teams, players] = await Promise.all([loadTeams({ fresh }), loadPlayers({ fresh })]);
  return {
    teams,
    players,
    teamsById: Object.fromEntries(teams.map((t) => [t.id, t])),
    playersById: Object.fromEntries(players.map((p) => [p.id, p])),
  };
}
