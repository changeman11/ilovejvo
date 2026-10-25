// Stat roles: three Discord roles per stat, 🥇 1st, 🥈 2nd and 🥉 3rd (changed 2026-10-25, was one
// "Top 3" role), each held by whoever is in that place right now, across every published event.
// Worked out from results, like the site's leaderboards. Ties share a place and skip the next
// (9, 9, 5 -> two 1sts and a 3rd). Pure planning only (tested).
// A role is keyed "statKey:place", e.g. "pts:1".
import { DEFAULT_STATS } from '../site-rules/defaults.js';
import { STAT_STYLE } from '../site-rules/stat-style.js';

export const STAT_ROLE_STATS = DEFAULT_STATS;
// Each award's look: a title with emoji flair, a colour, and a second colour for a gradient (used
// where the server has enhanced role colours). The emoji is also the role icon where the server
// allows role icons (boost level 2).
// The names, emoji and colours are shared with the site's Stats page (site-rules/stat-style.js).
export const STAT_ROLE_STYLE = STAT_STYLE;
export const statRoleStyle = (stat) => STAT_ROLE_STYLE[stat.key] ?? { title: stat.name, emoji: '🏆', color: 0xffc533, color2: 0xff8a00 };
export const PLACE_MEDAL = ['🥇', '🥈', '🥉'];
export const placeWord = (place) => ['1st', '2nd', '3rd'][place - 1] ?? `${place}th`;
// "🥇 1st · Spike Royalty 💥"
export const statRoleName = (stat, place) => { const s = statRoleStyle(stat); return `${PLACE_MEDAL[place - 1] ?? '🏅'} ${placeWord(place)} · ${s.title} ${s.emoji}`; };
export const roleKey = (statKey, place) => `${statKey}:${place}`;
// Bump when the look changes, so the bot restyles roles it made before.
export const STAT_ROLE_LOOK = 4;

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

// Each player's place for one stat (1 = best; ties share a place, the next place is skipped),
// for places 1..top only. Zero never counts. -> [[playerId, place]]
export function placesFor(totals, key, top = 3) {
  const ranked = [...totals].map(([pid, t]) => [pid, t[key] ?? 0]).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]);
  const out = [];
  let place = 0;
  ranked.forEach(([pid, v], i) => {
    if (i === 0 || v < ranked[i - 1][1]) place = i + 1;
    if (place <= top) out.push([pid, place]);
  });
  return out;
}

// -> Map "statKey:place" -> Set(discordIds) of who should hold each role (every key present).
// players: Map playerId -> { discordId }
export function wantedHolders(totals, players, top = 3) {
  const out = new Map();
  for (const { key } of STAT_ROLE_STATS) {
    for (let place = 1; place <= top; place++) out.set(roleKey(key, place), new Set());
    for (const [pid, place] of placesFor(totals, key, top)) {
      const id = String(players.get(pid)?.discordId ?? '');
      if (/^\d{15,22}$/.test(id)) out.get(roleKey(key, place)).add(id);
    }
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
