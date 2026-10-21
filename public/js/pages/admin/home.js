// Admin home: every exhibition night and tournament (drafts included), plus the hidden league tools.

import { loadAllEvents } from '../../data.js';
import { EVENT_TYPES, EVENT_STATUSES, eventDateLabel, sortEvents } from '../../rules/events.js';
import { esc, skeleton } from '../../ui.js';
import { adminGate, adminBar, bindAuthActions } from './gate.js';

export const title = 'Admin';

export function loading() {
  return `<div class="grid">${skeleton([60, 240, 240])}</div>`;
}

export function mount(el) {
  const root = el.querySelector('.admin-root');
  if (root) bindAuthActions(root);
}

function row(e) {
  const badges = [
    e.published ? '<span class="tag tag-live">Published</span>' : '<span class="tag tag-draft">Draft</span>',
    e.status !== 'upcoming' ? `<span class="tag tag-${esc(e.status)}">${esc(EVENT_STATUSES[e.status] ?? e.status)}</span>` : '',
  ].join('');
  return `
    <a class="admin-event" href="/admin/event/${encodeURIComponent(e.id)}" data-link>
      <span class="ae-main"><b>${esc(e.title)}</b><small class="muted">${esc(eventDateLabel(e))}</small></span>
      <span class="ae-badges">${badges}</span>
      <span aria-hidden="true">›</span>
    </a>`;
}

export async function render() {
  const gate = await adminGate();
  if (gate.html) return { title: 'Admin sign-in', html: `<div class="admin-root">${gate.html}</div>` };

  const events = await loadAllEvents();
  const block = (type) => {
    const cfg = EVENT_TYPES[type];
    const { upcoming, past } = sortEvents(events.filter((e) => e.type === type));
    const list = [...upcoming, ...past];
    return `
      <section class="card">
        <div class="section-head">
          <h2>${esc(cfg.plural)}</h2>
          <a class="btn btn-sm" href="/admin/event/new?type=${type}" data-link>+ Add</a>
        </div>
        ${list.length ? `<div class="admin-events">${list.map(row).join('')}</div>` : `<p class="muted">None yet. Add the first one.</p>`}
      </section>`;
  };

  return {
    title: 'Admin',
    html: `
      <div class="admin-root">
        ${adminBar(gate.user, gate.admin)}
        <section class="hero"><span class="eyebrow">Admin</span><h1>Events</h1></section>
        <p class="muted small">Drafts are only visible to admins. Leave the date empty to show “Date TBD”.</p>
        <div class="grid">
          ${block('exhibition')}
          ${block('tournament')}
          <section class="card">
            <div class="section-head"><h2>League (hidden)</h2></div>
            <p class="muted">The league is closed to the public for now. Only admins can open these.</p>
            <div class="admin-tools">
              <a class="btn btn-ghost btn-sm" href="/admin/matchday" data-link>Match day &amp; results</a>
              <a class="btn btn-ghost btn-sm" href="/league" data-link>League preview</a>
            </div>
          </section>
        </div>
      </div>`,
  };
}
