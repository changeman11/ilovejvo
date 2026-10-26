// Which event's stats hold the awards (added 2026-10-26). Stats are kept per event; the award
// holders (Stats page cards and the bot's 1st/2nd/3rd Discord roles) come from the most recent
// COMPLETED event, and stay until the next event completes, then rotate to that one.
// Complete = an admin marked it finished, or its podium is decided (final played, or every match
// of a no-knockout event has a score). Pure, shared with the bot (bot/src/site-rules/).
import { podium } from './podium.js';
import { DEFAULT_FORMAT, DEFAULT_STATS, DEFAULT_STANDINGS } from './defaults.js';

// The engine's "season" for an event (the same as data.js engineSeason), for code without data.js.
export function seasonOf(event) {
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

// Has any player stats been saved for this event?
export const hasStats = (b) => Object.values(b.results ?? {}).some((r) => !r?.forfeit && Object.keys(r?.playerStats ?? {}).length);

export function eventComplete(b) {
  const e = b.event ?? {};
  if (e.status === 'cancelled') return false;
  if (e.status === 'finished') return true;
  try {
    return Boolean(podium({ ...b, season: b.season ?? seasonOf(e) }));
  } catch {
    return false;
  }
}

// The newest completed, published event with stats: its bundle, or null.
// bundles: [{ event, season?, fixtures, results, teams }]
export function awardEvent(bundles) {
  return [...bundles]
    .filter((b) => b.event?.published !== false && eventComplete(b) && hasStats(b))
    .sort((x, y) => (y.event.date ?? y.event.createdAt ?? 0) - (x.event.date ?? x.event.createdAt ?? 0))[0] ?? null;
}

// The event the Stats page opens on: the newest event with stats (it may still be on).
export function latestStatsEvent(bundles) {
  return [...bundles]
    .filter((b) => b.event?.published !== false && b.event?.status !== 'cancelled' && hasStats(b))
    .sort((x, y) => (y.event.date ?? y.event.createdAt ?? 0) - (x.event.date ?? x.event.createdAt ?? 0))[0] ?? null;
}
