// Player stats added up across events (career), from every event's results.

import { seasonMatches } from '../rules/season.js';
import { seasonPlayerStats } from '../rules/stats.js';
import { DEFAULT_STATS } from '../rules/defaults.js';

// The stat columns to show: the default list, plus any extra an event uses.
export function statDefsFor(bundles) {
  const defs = [...DEFAULT_STATS];
  for (const b of bundles) for (const s of b.season.stats ?? []) if (!defs.some((d) => d.key === s.key)) defs.push(s);
  return defs;
}

// Map playerId -> { playerId, matches, sets, wins, mvps, totals, teamIds, log: [{ ...entry, eventId }] }
export function careerStats(bundles) {
  const keys = statDefsFor(bundles).map((s) => s.key);
  const out = new Map();
  for (const b of bundles) {
    const { matches } = seasonMatches(b);
    const players = seasonPlayerStats({ matches, results: b.results, statKeys: keys });
    for (const p of players.values()) {
      if (!out.has(p.playerId)) {
        out.set(p.playerId, { playerId: p.playerId, matches: 0, sets: 0, wins: 0, mvps: 0, totals: Object.fromEntries(keys.map((k) => [k, 0])), teamIds: [], log: [] });
      }
      const c = out.get(p.playerId);
      c.matches += p.matches;
      c.sets += p.sets;
      c.wins += p.wins;
      c.mvps += p.mvps;
      for (const k of keys) c.totals[k] += p.totals[k] ?? 0;
      for (const t of p.teamIds) if (!c.teamIds.includes(t)) c.teamIds.push(t);
      c.log.push(...p.log.map((l) => ({ ...l, eventId: b.event.id })));
    }
  }
  return out;
}

// Value of a stat under a "per" mode: total, per match or per set. 'mvps' is the MVP count.
export function statValue(entry, key, mode = 'total') {
  const total = key === 'mvps' ? entry.mvps : entry.totals[key] ?? 0;
  if (mode === 'match') return entry.matches ? total / entry.matches : 0;
  if (mode === 'set') return entry.sets ? total / entry.sets : 0;
  return total;
}

// Top N players for a stat. Ties: fewer matches first, then id.
export function topPlayers(stats, key, { limit = 5, mode = 'total', minMatches = 1 } = {}) {
  return [...stats.values()]
    .filter((p) => p.matches >= minMatches)
    .map((p) => ({ p, v: statValue(p, key, mode) }))
    .filter((r) => r.v > 0)
    .sort((a, b) => b.v - a.v || a.p.matches - b.p.matches || a.p.playerId.localeCompare(b.p.playerId))
    .slice(0, limit);
}
