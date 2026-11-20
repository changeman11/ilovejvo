// Stats eras (added 2026-11-21): just volleyball launched on 21 November 2026, so every event
// before that is PRE-LAUNCH. Their results and stats are kept, but shown only in the
// "Pre-launch stats" archive; live stats (careers, Stats page, awards and Discord award roles,
// levels and badges) count launch-day events onwards, starting from 0.
// An event can override it with event.era = 'live' | 'pre-launch'.
// Pure, shared with the bot (bot/src/site-rules/).

// 21 Nov 2026, 00:00 in Sydney (AEDT, UTC+11).
export const LAUNCH_AT = Date.UTC(2026, 10, 20, 13, 0, 0);
export const PRE_LAUNCH_LABEL = 'Pre-launch stats';

export function isPreLaunch(event) {
  if (event?.era === 'pre-launch') return true;
  if (event?.era === 'live') return false;
  const when = event?.date ?? event?.createdAt ?? null;
  return when != null && when < LAUNCH_AT;
}

// Bundles ({ event, … }) that count for live stats / that are in the pre-launch archive.
export const liveBundles = (bundles) => bundles.filter((b) => !isPreLaunch(b.event));
export const preLaunchBundles = (bundles) => bundles.filter((b) => isPreLaunch(b.event));
