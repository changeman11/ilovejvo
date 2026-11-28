// Saves worked-out schedules (rules/autofix.js) whenever an admin is signed in:
// - the round robin, once its event reaches the lock (5 minutes before the start)
// - finals, as soon as both teams are known (group table finished, or semi-finals played)
// - when the finals open after the break (rules/flow.js), so the rules can check it too
// There's no server doing this, so any admin browser that's open does it (at most once a minute).

import { currentAdmin } from './auth.js';
import { loadAllBundles } from './data.js';
import { saveSchedule, saveFlow } from './admin-data.js';
import { finalsOpenToSave } from './rules/flow.js';
import { drawToSave } from './rules/autofix.js';

let lastRun = 0;
let running = null;
// For the once-a-minute timer (adminTick): only tabs already known to be an admin's, and only while
// an event is close to its start or running, so it costs nothing for players or quiet days.
let knownAdmin = false;
let eventNear = false;
const nearNow = (bundles, now) => bundles.some((b) => b.event.status === 'upcoming' && b.event.published !== false
  && b.event.date && now >= b.event.date - 20 * 60000 && now <= b.event.date + 12 * 3600000);

export function adminTick() {
  if (!knownAdmin || !eventNear) return Promise.resolve(0);
  return syncSchedules();
}

export function syncSchedules({ force = false } = {}) {
  if (running) return running;
  if (!force && Date.now() - lastRun < 60000) return Promise.resolve(0);
  lastRun = Date.now();
  running = (async () => {
    // ignoreMode: fixtures still get saved at the lock while a Discord admin has admin mode off.
    const { user, admin } = await currentAdmin({ ignoreMode: true }).catch(() => ({}));
    knownAdmin = !!admin;
    if (!admin) return 0;
    const bundles = await loadAllBundles({ includeDrafts: true, fresh: true });
    eventNear = nearNow(bundles, Date.now());
    let saved = 0;
    for (const b of bundles) {
      const opensAt = finalsOpenToSave(b, Date.now());
      if (opensAt) {
        await saveFlow({ eventId: b.event.id, uid: user.uid, event: b.event, changes: { finalsOpenAt: opensAt } })
          .catch((err) => console.warn('Saving the finals time for', b.event.id, err));
      }
      const { toSave, lockGroup } = b.plan;
      if (!toSave.length) continue;
      try {
        await saveSchedule({ eventId: b.event.id, uid: user.uid, fixtures: toSave, lockGroup, event: b.event, draw: lockGroup ? drawToSave(b.plan) : null });
        saved += toSave.length;
      } catch (err) {
        console.warn('Saving the schedule for', b.event.id, err);
      }
    }
    return saved;
  })().finally(() => { running = null; });
  return running;
}
