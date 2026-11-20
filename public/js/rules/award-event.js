// Which event's stats hold the awards. Stats are kept per event; the award holders (Stats page
// cards and the bot's 1st/2nd/3rd Discord roles) come from the LAST EVENT WITH STATS, and reset
// automatically as soon as a newer event has stats of its own (changed 2026-11-21; from 2026-10-26
// it waited for the next event to be complete, which a never-played "if needed" final could block).
// Pure, shared with the bot (bot/src/site-rules/).
import { podium } from './podium.js';
import { isPreLaunch } from './eras.js';
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

const when = (b) => b.event.date ?? b.event.createdAt ?? 0;

// Every published, not cancelled event with stats, newest first. Pre-launch events (rules/eras.js)
// are left out unless { preLaunch: true }: awards and live stats start from launch day.
export function statsEvents(bundles, { preLaunch = false } = {}) {
  return [...bundles]
    .filter((b) => b.event?.published !== false && b.event?.status !== 'cancelled' && hasStats(b) && isPreLaunch(b.event) === preLaunch)
    .sort((x, y) => when(y) - when(x));
}

// The event the Stats page opens on ("Last event"): the newest event with stats (it may still be on).
export function latestStatsEvent(bundles) {
  return statsEvents(bundles)[0] ?? null;
}

// The award event: the same, the last event with stats. Its bundle, or null.
// bundles: [{ event, season?, fixtures, results, teams }]
export const awardEvent = latestStatsEvent;
