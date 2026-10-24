// Stat roles: a Discord role per stat (Top 3 · Points, Top 3 · Spikes, ...) held by whoever is in
// the top 3 for it right now, across every published event. Worked out from results, like the
// site's leaderboards; ties for 3rd place all get it. Pure planning only (tested).
import { DEFAULT_STATS } from '../site-rules/defaults.js';

export const STAT_ROLE_STATS = DEFAULT_STATS;
export const statRoleName = (stat, top) => `🏆 Top ${top} · ${stat.name}`;

// results: [{ playerStats: { playerId: { pts, spk, ... } } }] -> Map playerId -> { pts: total, ... }
export function statTotals(results) {
  const totals = new Map();
  for (const r of results) {
    if (r?.forfeit) continue;
    for (const [pid, line] of Object.entries(r?.playerStats ?? {})) {
      if (!totals.has(pid)) totals.set(pid, {});
      const t = totals.get(pid);
      for (const { key } of STAT_ROLE_STATS) t[key] = (t[key] ?? 0) + (Number(line?.[key]) || 0);
    }
  }
  return totals;
}

// The players in the top `top` for one stat (more when tied for the last place). Zero never counts.
export function topFor(totals, key, top = 3) {
  const ranked = [...totals].map(([pid, t]) => [pid, t[key] ?? 0]).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]);
  if (!ranked.length) return [];
  const cut = ranked[Math.min(top, ranked.length) - 1][1];
  return ranked.filter(([, v]) => v >= cut).map(([pid]) => pid);
}

// -> Map statKey -> Set(discordIds) of who should hold each role.
// players: Map playerId -> { discordId }
export function wantedHolders(totals, players, top = 3) {
  const out = new Map();
  for (const { key } of STAT_ROLE_STATS) {
    const ids = new Set();
    for (const pid of topFor(totals, key, top)) {
      const id = String(players.get(pid)?.discordId ?? '');
      if (/^\d{15,22}$/.test(id)) ids.add(id);
    }
    out.set(key, ids);
  }
  return out;
}

// What to change, given who had each role last time (saved by the bot).
//   before: { statKey: [discordIds] }, want: Map statKey -> Set
//   -> { add: [{ key, userId }], remove: [{ key, userId }] }
export function planHolders({ before, want }) {
  const add = [];
  const remove = [];
  for (const [key, ids] of want) {
    const had = new Set(before?.[key] ?? []);
    for (const id of ids) if (!had.has(id)) add.push({ key, userId: id });
    for (const id of had) if (!ids.has(id)) remove.push({ key, userId: id });
  }
  return { add, remove };
}
