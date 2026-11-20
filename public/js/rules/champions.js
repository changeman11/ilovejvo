// Event champions as people (added 2026-11-21): the players who won an event, not just the club.
// A champion player = anyone with a stat line for the winning team at that event, or on its event
// roster. Worked out from results (rules/podium.js), never stored. Pure, shared with the bot
// (bot/src/site-rules/): pre-launch winners get the "🏆 Pre-launch Champion" Discord role.
import { podium } from './podium.js';
import { isPreLaunch } from './eras.js';

// b: an event bundle ({ event, season, fixtures, results, teams, rosters? }).
// -> { eventId, title, date, teamId, playerIds, preLaunch } or null (not decided, or a shared 1st).
export function eventChampions(b) {
  if (b.event?.published === false || b.event?.status === 'cancelled') return null;
  let p = null;
  try { p = podium(b); } catch { return null; }
  const first = p?.places.find((x) => x.place === 1);
  if (!first || first.teamIds.length !== 1) return null;
  const teamId = first.teamIds[0];
  const ids = new Set();
  for (const r of Object.values(b.results ?? {})) {
    for (const [pid, line] of Object.entries(r?.playerStats ?? {})) if (line?.teamId === teamId) ids.add(pid);
  }
  const roster = Array.isArray(b.rosters) ? b.rosters.find((x) => x.teamId === teamId || x.id === teamId) : b.rosters?.[teamId];
  for (const pid of roster?.playerIds ?? []) ids.add(pid);
  return { eventId: b.event.id, title: b.event.title, date: b.event.date ?? b.event.createdAt ?? 0, teamId, playerIds: [...ids].sort(), preLaunch: isPreLaunch(b.event) };
}

// Every decided event's champions, newest first.
export function allChampions(bundles) {
  return bundles.map(eventChampions).filter(Boolean).sort((x, y) => y.date - x.date);
}

// The titles one player has won: [{ eventId, title, teamId, preLaunch }].
export const titlesOf = (champions, playerId) => champions.filter((c) => c.playerIds.includes(playerId));
