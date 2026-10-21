// Admin home: every event (drafts included), with what needs a result.

import { loadAllEvents, loadAllBundles } from '../../data.js';
import { EVENT_TYPES, EVENT_STATUSES, eventDateLabel, sortEvents } from '../../rules/events.js';
import { esc, skeleton, urls } from '../../ui.js';
import { fixtureRow } from '../parts.js';
import { adminGate, adminBar, bindAuthActions } from './gate.js';

export const title = 'Admin';

export function loading() {
  return skeleton([50, 260]);
}

export function mount(el) {
  const root = el.querySelector('.admin-root');
  if (root) bindAuthActions(root);
}

export async function render() {
  const gate = await adminGate();
  if (gate.html) return { title: 'Admin sign-in', html: `<div class="admin-root">${gate.html}</div>` };

  const [events, bundles] = await Promise.all([loadAllEvents(), loadAllBundles({ includeDrafts: true, fresh: true })]);
  const { upcoming, past } = sortEvents(events);
  const now = Date.now();
  const waiting = bundles.flatMap((b) => b.fixtures
    .filter((f) => !b.results[f.id] && f.scheduledAt && f.scheduledAt <= now && f.homeTeamId && f.awayTeamId)
    .map((f) => ({ b, f })));

  const row = (e) => `
    <a class="row" href="${urls.adminEvent(e.id)}" data-link>
      <span class="row-main"><b>${esc(e.title)}</b><span class="muted small">${esc(EVENT_TYPES[e.type]?.label)} · ${esc(eventDateLabel(e))}</span></span>
      <span class="row-side">
        ${e.published ? '<span class="tag tag-live">Published</span>' : '<span class="tag tag-draft">Draft</span>'}
        ${e.status !== 'upcoming' ? `<span class="tag tag-${esc(e.status)}">${esc(EVENT_STATUSES[e.status])}</span>` : ''}
      </span>
    </a>`;

  return {
    title: 'Admin',
    html: `
      <div class="admin-root">
        ${adminBar(gate.user, gate.admin, '/admin')}
        <div class="page-head">
          <div><h1>Events</h1><p class="muted">Each event holds its own teams, fixtures and results. Drafts are only visible to admins.</p></div>
          <div class="event-links">
            <a class="btn btn-primary" href="/admin/event/new?type=exhibition" data-link>+ Exhibition night</a>
            <a class="btn" href="/admin/event/new?type=tournament" data-link>+ Tournament</a>
          </div>
        </div>
        <div class="stack">
          ${waiting.length ? `<section>
            <div class="section-head"><h2>Needs a result</h2><span class="muted small">${waiting.length} played match${waiting.length === 1 ? '' : 'es'}</span></div>
            <div class="panel flush fixtures">${waiting.map(({ b, f }) => fixtureRow(b, f, { showEvent: true, href: urls.adminResult(b.event.id, f.id) })).join('')}</div>
          </section>` : ''}
          <section>
            <div class="section-head"><h2>Upcoming</h2></div>
            <div class="panel flush rows">${upcoming.map(row).join('') || '<p class="muted" style="padding:16px">No upcoming events. Add one above.</p>'}</div>
          </section>
          ${past.length ? `<section><div class="section-head"><h2>Past</h2></div><div class="panel flush rows">${past.map(row).join('')}</div></section>` : ''}
        </div>
      </div>`,
  };
}
