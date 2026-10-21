// Reads league data from Firestore and turns it into plain objects the pages can use.
// Dates become milliseconds so the rules engine never sees Firebase types.
// Everything is cached for the visit; refresh the page to get the latest.

import {
  doc,
  getDoc,
  getDocs,
  collection,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from './firebase.js';

export class NotFoundError extends Error {}

function plain(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  }
  return value;
}

async function getOne(path) {
  const snap = await getDoc(doc(db, path));
  return snap.exists() ? { id: snap.id, ...plain(snap.data()) } : null;
}

async function getAll(path) {
  const snap = await getDocs(collection(db, path));
  return snap.docs.map((d) => ({ id: d.id, ...plain(d.data()) }));
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

export const loadSettings = () => cached('settings', () => getOne('settings/site').then((s) => s ?? {}));

// All seasons, oldest first.
export const loadSeasonList = () =>
  cached('seasons', () => getAll('seasons').then((list) => list.sort((a, b) => (a.kickoffAt ?? 0) - (b.kickoffAt ?? 0))));

const loadTeams = () => cached('teams', () => getAll('teams'));
const loadPlayers = () => cached('players', () => getAll('players'));

// Forget a season's cached data, e.g. after an admin saves a result.
export function invalidateSeason(seasonId) {
  cache.delete(`season:${seasonId}`);
}

// Everything a season page needs, loaded in parallel.
// fresh: true skips the cache (admin pages always want the latest).
export function loadSeason(seasonId, { fresh = false } = {}) {
  if (fresh) invalidateSeason(seasonId);
  return cached(`season:${seasonId}`, async () => {
    const base = `seasons/${seasonId}`;
    const [season, teams, players, rosters, fixtures, results] = await Promise.all([
      getOne(base),
      loadTeams(),
      loadPlayers(),
      getAll(`${base}/rosters`),
      getAll(`${base}/fixtures`),
      getAll(`${base}/results`),
    ]);
    if (!season) throw new NotFoundError(`Season "${seasonId}" not found`);
    const seasonTeamIds = new Set((season.divisions ?? []).flatMap((d) => d.teamIds ?? []));
    return {
      season,
      teams: teams.filter((t) => seasonTeamIds.has(t.id)),
      teamsById: Object.fromEntries(teams.map((t) => [t.id, t])),
      playersById: Object.fromEntries(players.map((p) => [p.id, p])),
      rosters: Object.fromEntries(rosters.map((r) => [r.id, r])),
      fixtures,
      results: Object.fromEntries(results.map((r) => [r.id, r])),
    };
  });
}

// The season the home page shows by default (can differ from the current one between seasons).
export async function homeSeasonId() {
  const settings = await loadSettings();
  const id = settings.homeSeasonId ?? settings.currentSeasonId;
  if (id) return id;
  const list = await loadSeasonList();
  if (!list.length) throw new NotFoundError('No season set up yet');
  return list[list.length - 1].id;
}

export async function loadHomeSeason() {
  return { settings: await loadSettings(), ...(await loadSeason(await homeSeasonId())) };
}

// The season named in the URL (?season=s0), or the home season.
export async function loadSeasonFromUrl({ fresh = false } = {}) {
  const fromUrl = new URLSearchParams(location.search).get('season');
  const [seasons, settings] = await Promise.all([loadSeasonList(), loadSettings()]);
  const id = fromUrl && seasons.some((s) => s.id === fromUrl) ? fromUrl : await homeSeasonId();
  return { settings, seasons, ...(await loadSeason(id, { fresh })) };
}

// Every season's data, oldest first. Used by profiles for career stats.
export async function loadAllSeasons() {
  const list = await loadSeasonList();
  return Promise.all(list.map((s) => loadSeason(s.id)));
}
