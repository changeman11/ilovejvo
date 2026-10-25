// Reads data from Firestore and turns it into plain objects the pages can use.
// Dates become milliseconds so the rules engine never sees Firebase types.
//
// Everything is LIVE (changed 2026-10-24): each document or collection a page reads gets a
// Firestore listener that stays open for the visit, so the copy here is always current. When
// anything changes, onDataChange() listeners run (app.js redraws the page, the bell, the bars),
// so nobody has to refresh. A listener costs one read per document at the start (the same as a
// plain read) and then only one read per changed document.
//
// `admin: true` reads through the admin sign-in (see firebase.js), which can see drafts and
// requests. Everything else reads through the public/player connection.

import {
  doc, collection, query, where, orderBy, limit, onSnapshot,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db, adminDatabase } from './firebase.js';
import { DEFAULT_FORMAT, DEFAULT_STATS, DEFAULT_STANDINGS } from './rules/defaults.js';
import { schedulePlan } from './rules/autofix.js';
import { mediaUrl } from './media.js';

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

// Saves still waiting for the server have a null time; estimate it so new things sort first.
const asObj = (d) => ({ id: d.id, ...plain(d.data({ serverTimestamps: 'estimate' })) });

// ---------- Live copies ----------
// live: key -> { promise, stop }. Each is one listener; the promise always holds the latest copy.
// Admin reads are kept separately (keys start with "A|").
const live = new Map();
const changeListeners = new Set();
let changeTimer = null;
let changedKeys = new Set();

// Runs fn(keys) shortly after anything read here changes (several changes are grouped together).
export function onDataChange(fn) {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

function changed(key) {
  changedKeys.add(key);
  derived.clear(); // anything built from the old copies is out of date
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => {
    const keys = changedKeys;
    changedKeys = new Set();
    for (const fn of changeListeners) {
      try { fn(keys); } catch (err) { console.error(err); }
    }
  }, 250);
}

// ref: a document or a query. map(snapshot) -> the plain value to keep.
function watch(key, admin, ref, map) {
  const k = admin ? `A|${key}` : key;
  if (live.has(k)) return live.get(k).promise;
  const entry = { promise: null, stop: () => {} };
  entry.promise = new Promise((resolve, reject) => {
    let first = true;
    entry.stop = onSnapshot(ref, (snap) => {
      const value = map(snap);
      entry.promise = Promise.resolve(value);
      if (first) { first = false; resolve(value); } else changed(k);
    }, (err) => {
      // Not allowed (any more), e.g. signed out or an event made a draft: forget it.
      if (live.get(k) === entry) live.delete(k);
      if (first) { first = false; reject(err); } else changed(k);
    });
  });
  live.set(k, entry);
  return entry.promise;
}

const getOne = (path, admin = false) =>
  watch(`doc:${path}`, admin, doc(dbFor(admin), path), (snap) => (snap.exists() ? asObj(snap) : null));

const getAll = (path, admin = false) =>
  watch(`col:${path}`, admin, collection(dbFor(admin), path), (snap) => snap.docs.map(asObj));

const queryAll = (path, field, value, admin = false) =>
  watch(`q:${path}:${field}=${value}`, admin, query(collection(dbFor(admin), path), where(field, '==', value)), (snap) => snap.docs.map(asObj));

// Things worked out from the live copies (e.g. an event's schedule), kept until the next change.
const derived = new Map();
function cached(key, admin, load) {
  const k = admin ? `A|${key}` : key;
  if (!derived.has(k)) {
    const p = load();
    p.catch(() => derived.delete(k));
    derived.set(k, p);
  }
  return derived.get(k);
}

// Pages call this after a save. The live copies update themselves, so this only drops worked-out
// values (they're rebuilt from the latest copies on the next read).
export function invalidate(prefix = '') {
  for (const key of [...derived.keys()]) {
    if (key.startsWith(prefix) || key.startsWith(`A|${prefix}`)) derived.delete(key);
  }
}

// Stops every admin listener (the admin signed out).
export function stopAdminLive() {
  for (const [k, entry] of [...live]) {
    if (k.startsWith('A|')) { entry.stop(); live.delete(k); }
  }
  derived.clear();
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
    const [teams, players, rosters, fixtures, results, submissions, entries, solos, ready] = await Promise.all([
      loadTeams({ fresh, admin }),
      loadPlayers({ fresh, admin }),
      getAll(`${base}/rosters`, admin),
      getAll(`${base}/fixtures`, admin),
      getAll(`${base}/results`, admin),
      // Players' result votes (see rules/votes.js). Missing on older events = none yet.
      getAll(`${base}/submissions`, admin).catch(() => []),
      // Clubs that signed themselves up (rules/autofix.js).
      getAll(`${base}/entries`, admin).catch(() => []),
      // Players who signed up solo (admins group them into mix teams).
      getAll(`${base}/solos`, admin).catch(() => []),
      // Players who pressed Ready for a match (rules/flow.js ready-up).
      getAll(`${base}/ready`, admin).catch(() => []),
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
      solos,
      ready,
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

// ---------- Transfer news (the latest 30, newest first) ----------

export const loadTransfers = () =>
  watch('transfers:latest', false, query(collection(db, 'transfers'), orderBy('at', 'desc'), limit(30)), (snap) => snap.docs.map(asObj));

// ---------- Comments on a team or player page (live, newest first) ----------

export async function loadComments(kind, id) {
  const list = await getAll(`${kind}s/${id}/comments`).catch(() => []);
  return [...list].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

// ---------- Site settings (settings/{id}: faq, rules) ----------

export function loadSetting(id, { fresh = false, admin = false } = {}) {
  if (fresh) invalidate(`setting:${id}`);
  return cached(`setting:${id}`, admin, () => getOne(`settings/${id}`, admin));
}

// ---------- Community characters (Home court) ----------
// The hand-made ones (images/characters/list.json; admins hide them with settings/characters.hidden)
// and the ones the Discord bot adds (Firestore characters/{key}; status pending | approved | denied,
// missing = approved, for the ones added before approvals existed). -> { all, live, setting }
//   all: [{ name, src, source: 'hand'|'bot', status: 'pending'|'approved'|'denied'|'hidden', key?, author?, postedAt?, doc? }]
//   live: what the court shows (approved and not hidden).
export async function loadCharacters({ admin = false } = {}) {
  const [files, docs, setting] = await Promise.all([
    fetch('/images/characters/list.json', { cache: 'no-cache' }).then((r) => r.json()).catch(() => []),
    getAll('characters', admin).catch(() => []),
    loadSetting('characters', { admin }).catch(() => null),
  ]);
  const hidden = new Set(setting?.hidden ?? []);
  const all = [
    ...files.map((name) => ({ name, src: `/images/characters/${name}`, source: 'hand', status: hidden.has(name) ? 'hidden' : 'approved' })),
    ...docs.filter((d) => d.path).map((d) => ({
      name: `${d.key ?? d.id}.png`, key: d.id, src: mediaUrl(d.path), source: 'bot', status: d.status ?? 'approved',
      author: d.author ?? null, postedAt: d.postedAt ?? null, doc: d,
    })),
  ];
  return { all, live: all.filter((c) => c.status === 'approved'), setting };
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

// ---------- Pickup games (the Discord bot in bot/, BOT-SETUP.md) ----------
// pickupRatings/{discordId}, pickupGames/g{n}, pickupMeta/live: written by the bot, public to read.

// Everyone with a pickup rating and at least one game, best first.
export const loadPickupRatings = ({ fresh = false } = {}) => {
  if (fresh) invalidate('pickup:ratings');
  return cached('pickup:ratings', false, async () => (await getAll('pickupRatings'))
    .filter((r) => r.games > 0)
    .sort((x, y) => y.rating - x.rating || y.wins - x.wins || String(x.name).localeCompare(String(y.name))));
};

// A player's rating and rank, by Discord ID: { rating, rank, total } or null.
export async function loadPickupRank(discordId) {
  if (!discordId) return null;
  const list = await loadPickupRatings().catch(() => []);
  const i = list.findIndex((r) => r.id === String(discordId));
  return i < 0 ? null : { rating: list[i], rank: i + 1, total: list.length };
}

export const loadPickupGames = (count = 15) =>
  watch(`pickupGames:latest:${count}`, false, query(collection(db, 'pickupGames'), orderBy('createdAt', 'desc'), limit(count)), (snap) => snap.docs.map(asObj));

// The Discord match thread for one match (bot/src/matches.js), or null.
export const loadMatchThread = (eventId, fixtureId) => getOne(`matchThreads/${eventId}__${fixtureId}`).catch(() => null);

export const loadPickupLive = () => getOne('pickupMeta/live').catch(() => null);
export const loadPickupSignup = (discordId) => (discordId ? getOne(`pickupSignups/${discordId}`).catch(() => null) : Promise.resolve(null));

// ---------- 1v1 ranked (bot/src/ranked.js): rankedRatings, pickupMeta/live1v1, rankedSignups ----------
export const loadRankedRatings = ({ fresh = false } = {}) => {
  if (fresh) invalidate('ranked:ratings');
  return cached('ranked:ratings', false, async () => (await getAll('rankedRatings')).filter((r) => r.games > 0));
};

// RP and rank (placed players only, by RP) by Discord ID: { rating, rank, total } or null.
export async function loadRankedRank(discordId) {
  if (!discordId) return null;
  const list = await loadRankedRatings().catch(() => []);
  const r = list.find((x) => x.id === String(discordId));
  if (!r) return null;
  const placed = list.filter((x) => x.games >= 5).sort((x, y) => y.rating - x.rating || y.wins - x.wins);
  const i = placed.findIndex((x) => x.id === r.id);
  return { rating: r, rank: i + 1, total: placed.length };
}

export const loadRankedLive = () => getOne('pickupMeta/live1v1').catch(() => null);
export const loadRankedSignup = (discordId) => (discordId ? getOne(`rankedSignups/${discordId}`).catch(() => null) : Promise.resolve(null));
