// The "Live now" pieces for an event that's running (rules/flow.js liveSummary): a one-line stage
// ("Group stage · 3 on now", "Break · finals at 7:45 pm AEDT"...) and the Home panel with the
// matches on now and the latest confirmed scores. The FEATURED! card uses the same text.

import { esc, urls, fmtTime } from '../ui.js';
import { zoneLabel } from '../rules/events.js';
import { liveSummary } from '../rules/flow.js';
import { fixtureRow } from './parts.js';

export function phaseText(live) {
  const on = live.open.length;
  const onNow = `${on} match${on === 1 ? '' : 'es'} on now`;
  if (live.phase === 'paused') return '⏸ Paused by the admins';
  if (live.phase === 'break') {
    return live.breakEndsAt
      ? `☕ Break · finals start ${fmtTime(live.breakEndsAt)} ${zoneLabel(live.breakEndsAt)}`
      : '☕ Break · finals start soon';
  }
  if (live.phase === 'finals') return `🏆 Finals · ${onNow}${live.readying?.length ? ` · ${live.readying.length} readying up` : ''}`;
  const readying = live.readying?.length ? ` · ${live.readying.length} readying up` : '';
  return `🏐 Group stage · ${onNow}${readying} · ${live.left} to play`;
}

// Every event running now: [{ b, live }]
export function liveEvents(bundles, now = Date.now()) {
  return bundles.filter((b) => b.event.published !== false).map((b) => ({ b, live: liveSummary(b, now) })).filter((x) => x.live);
}

// Home: one panel per running event.
export function livePanelsHtml(bundles, now = Date.now()) {
  return liveEvents(bundles, now).map(({ b, live }) => `
    <section class="live-panel">
      <div class="section-head">
        <h2><span class="live-dot" aria-hidden="true"></span> Live now · ${esc(b.event.title)}</h2>
        <a href="${urls.event(b.event.id)}" data-link>Event page</a>
      </div>
      <p class="live-phase">${esc(phaseText(live))}</p>
      <div class="cols">
        <div>
          <h3 class="live-h">On now</h3>
          <div class="panel flush fixtures">${live.open.map((f) => fixtureRow(b, f, { compact: true })).join('')
            || `<p class="muted" style="padding:14px 16px;margin:0">${live.phase === 'break' ? 'Nothing on during the break.' : 'Nothing on right now.'}</p>`}</div>
        </div>
        <div>
          <h3 class="live-h">Just in</h3>
          <div class="panel flush fixtures">${live.recent.slice(0, 5).map((f) => fixtureRow(b, f, { compact: true })).join('')
            || '<p class="muted" style="padding:14px 16px;margin:0">No scores yet.</p>'}</div>
        </div>
      </div>
    </section>`).join('');
}
