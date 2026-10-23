// Saves worked-out schedules (rules/autofix.js) whenever an admin is signed in:
// - the round robin, once its event reaches the lock (10 minutes before the start)
// - finals, as soon as both teams are known (group table finished, or semi-finals played)
// There's no server doing this, so any admin browser that's open does it (at most once a minute).

import { currentAdmin } from './auth.js';
import { loadAllBundles } from './data.js';
import { saveSchedule } from './admin-data.js';
import { drawToSave } from './rules/autofix.js';

let lastRun = 0;
let running = null;

export function syncSchedules({ force = false } = {}) {
  if (running) return running;
  if (!force && Date.now() - lastRun < 60000) return Promise.resolve(0);
  lastRun = Date.now();
  running = (async () => {
    // ignoreMode: fixtures still get saved at the lock while a Discord admin has admin mode off.
    const { user, admin } = await currentAdmin({ ignoreMode: true }).catch(() => ({}));
    if (!admin) return 0;
    const bundles = await loadAllBundles({ includeDrafts: true, fresh: true });
    let saved = 0;
    for (const b of bundles) {
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
