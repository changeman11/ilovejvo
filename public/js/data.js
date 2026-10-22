// Reads data from Firestore and turns it into plain objects the pages can use.
// Dates become milliseconds so the rules engine never sees Firebase types.
// Everything is cached for the visit; admin pages ask for fresh copies.
//
// `admin: true` reads through the admin sign-in (see firebase.js), which can see drafts and
// requests. Everything else reads through the public/player connection.

import {
  doc, getDoc, getDocs, collection, query, where,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db, adminDatabase } from './firebase.js';
import { DEFAULT_FORMAT, DEFAULT_STATS, DEFAULT_STANDINGS } from './rules/defaults.js';
import { schedulePlan } from './rules/autofix.js';

export class NotFoundError extends Error {}

const dbFor = (admin) => (admin ? adminDatabase() : db);

function plain(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  }
  return value;
}

const asObj = (d) => ({ id: d.id, ...plain(d.data()) });

async function getOne(path, admin = false) {
  const snap = await getDoc(doc(dbFor(admin), path));
  return snap.exists() ? asObj(snap) : null;
}

async function getAll(path, admin = false) {
  const snap = await getDocs(collection(dbFor(admin), path));
  return snap.docs.map(asObj);
}

async function queryAll(path, field, value, admin = false) {
  const snap = await getDocs(query(collection(dbFor(admin), path), where(field, '==', value)));
  return snap.docs.map(asObj);
}

// Caches a promise; drops it on failure so the next visit can retry.
// Admin reads are cached separately (keys start with "A|").
const cache = new Map();
function cached(key, admin, load) {
  const k = admin ? `A|${key}` : key;
  if (!cache.has(k)) {
    const p = load();
    p.catch(() => cache.delete(k));
    cache.set(k, p);
  }
  return cache.get(k);
}

// Forget cached data after a change (or pass nothing to forget everything). Clears both kinds.
export function invalidate(prefix = '') {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix) || key.startsWith(`A|${prefix}`)) cache.delete(key);
  }
}

// ---------- Teams and players (shared by every event) ----------

export const loadTeams = ({ fresh = false, admin = false } = {}) => {
  if (fresh) invalidate('teams');
  return cached('teams', admin, () => getAll('teams', admin));
};
export const loadPlayers = ({ fresh = false, admin = false } = {}) => {
  if (fresh) invalidate('players');
  return cached('players', admin, () => getAll('players', admin));
};

// Teams and players by id, without loading any event.
export async function loadPeople({ fresh = false, admin = false } = {}) {
  const [teams, players] = await Promise.all([loadTeams({ fresh, admin }), loadPlayers({ fresh, admin })]);
  return {
    teams,
    players,
    teamsById: Object.fromEntries(teams.map((t) => [t.id, t])),
    playersById: Object.fromEntries(players.map((p) => [p.id, p])),
  };
}

// A team counts as real once approved (older teams have no status = approved).
export const isApprovedTeam = (t) => Boolean(t) && (t.status ?? 'approved') === 'approved';

// ---------- Events ----------

// Published events only: what the public may see.
export const loadPublicEvents = () =>
  cached('events:public', false, () => queryAll('events', 'published', true));

// Every event including drafts (admins only; the rules refuse anyone else).
export async function loadAllEvents() {
  return getAll('events', true);
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
// Returns { event, season, teams, teamsById, playersById, rosters, fixtures, results, submissions }
export function loadEventBundle(eventId, { fresh = false, admin = false } = {}) {
  if (fresh) invalidate(`event:${eventId}`);
  return cached(`event:${eventId}`, admin, async () => {
    let event;
    try {
      event = await getOne(`events/${eventId}`, admin);
    } catch (err) {
      if (err.code === 'permission-denied') throw new NotFoundError('That event doesn’t exist');
      throw err;
    }
    if (!event) throw new NotFoundError('That event doesn’t exist');
    const base = `events/${eventId}`;
    const [teams, players, rosters, fixtures, results, submissions, entries] = await Promise.all([
      loadTeams({ fresh, admin }),
      loadPlayers({ fresh, admin }),
      getAll(`${base}/rosters`, admin),
      getAll(`${base}/fixtures`, admin),
      getAll(`${base}/results`, admin),
      // Players' result votes (see rules/votes.js). Missing on older events = none yet.
      getAll(`${base}/submissions`, admin).catch(() => []),
      // Clubs that signed themselves up (rules/autofix.js).
      getAll(`${base}/entries`, admin).catch(() => []),
    ]);
    const season = engineSeason(event);
    const resultsById = Object.fromEntries(results.map((r) => [r.id, r]));
    const saved = fixtures.map((f) => ({ ...f, round: f.order ?? 0 }));
    // The live schedule: the round robin from whoever has signed up, and finals placeholders.
    const plan = schedulePlan({ event, season, entries, fixtures: saved, results: resultsById });
    const teamIds = new Set(plan.teamIds);
    season.divisions = [{ id: 'main', teamIds: plan.teamIds }];
    return {
      event,
      season,
      teams: teams.filter((t) => teamIds.has(t.id)),
      teamsById: Object.fromEntries(teams.map((t) => [t.id, t])),
      playersById: Object.fromEntries(players.map((p) => [p.id, p])),
      rosters: Object.fromEntries(rosters.map((r) => [r.id, r])),
      // `round` keeps the engine's ordering for undated fixtures. Worked-out fixtures have `virtual: true`.
      fixtures: [...saved, ...plan.virtual.map((f) => ({ ...f, round: f.order ?? 0 }))],
      results: resultsById,
      submissions,
      entries,
      plan,
    };
  });
}

// Every published event's bundle (admins with includeDrafts: every event), oldest event first.
// Used for site-wide fixtures, stats and player careers.
export async function loadAllBundles({ includeDrafts = false, fresh = false } = {}) {
  const admin = includeDrafts;
  const events = admin ? await loadAllEvents() : await loadPublicEvents();
  const bundles = await Promise.all(events.map((e) => loadEventBundle(e.id, { fresh, admin })));
  return bundles.sort((a, b) => (a.event.date ?? a.event.createdAt ?? 0) - (b.event.date ?? b.event.createdAt ?? 0));
}

// ---------- Players' own things (Discord sign-in; the rules only return the player's own) ----------

// Everything the "Me" page needs for a signed-in player.
export async function loadMe(uid) {
  const [people, offers, leaves, claim, sentOffers, myJoinRequests] = await Promise.all([
    loadPeople({ fresh: true }),
    queryAll('offers', 'playerUid', uid),
    queryAll('leaveRequests', 'uid', uid),
    getOne(`claims/${uid}`),
    queryAll('offers', 'fromUid', uid),
    queryAll('joinRequests', 'uid', uid).catch(() => []),
  ]);
  const player = people.players.find((p) => p.uid === uid) ?? null;
  const team = player?.teamId ? people.teamsById[player.teamId] ?? null : null;
  const pendingTeam = people.teams.find((t) => t.managerUid === uid && t.status === 'pending') ?? null;
  // Managers also see who's asked to join their team.
  const teamJoinRequests = team && team.managerUid === uid && isApprovedTeam(team)
    ? await queryAll('joinRequests', 'teamId', team.id).catch(() => [])
    : [];
  return { ...people, player, team, pendingTeam, offers, sentOffers, leaves, claim, myJoinRequests, teamJoinRequests };
}

// A player's join request to one team (id "<teamId>__<playerId>"), or null. Only they can read it.
export function loadJoinRequest(teamId, playerId) {
  return getOne(`joinRequests/${teamId}__${playerId}`).catch(() => null);
}

// ---------- Comments on a team or player page (never cached, so new ones show straight away) ----------

export async function loadComments(kind, id) {
  const list = await getAll(`${kind}s/${id}/comments`).catch(() => []);
  return list.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

// ---------- Site settings (settings/{id}: faq, rules) ----------

export function loadSetting(id, { fresh = false, admin = false } = {}) {
  if (fresh) invalidate(`setting:${id}`);
  return cached(`setting:${id}`, admin, () => getOne(`settings/${id}`, admin));
}

// ---------- Admin inbox ----------

// Pending team registrations, leave requests and profile claims.
export async function loadRequests() {
  const [people, leaves, claims] = await Promise.all([
    loadPeople({ fresh: true, admin: true }),
    queryAll('leaveRequests', 'status', 'pending', true),
    queryAll('claims', 'status', 'pending', true),
  ]);
  return { ...people, pendingTeams: people.teams.filter((t) => t.status === 'pending'), leaves, claims };
}
