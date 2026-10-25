// Admin home: a plain-language "what needs you" list, quick buttons for the common jobs, then
// every event (drafts included). Reworked 2026-10-25 to be friendlier: each to-do says what it is,
// how many, and where to go, instead of admins having to know which page holds what.

import { loadAllEvents, loadAllBundles, loadRequests, loadCharacters } from '../../data.js';
import { EVENT_TYPES, EVENT_STATUSES, eventDateLabel, sortEvents } from '../../rules/events.js';
import { tallyVotes } from '../../rules/votes.js';
import { fixPending } from '../../rules/corrections.js';
import { esc, skeleton, urls } from '../../ui.js';
import { usernameOf } from '../../auth.js';
import { fixtureRow } from '../parts.js';
import { adminGate, adminBar, bindAuthActions } from './gate.js';
import { syncSchedules } from '../../admin-sync.js';

export const title = 'Admin';

export function loading() {
  return skeleton([50, 160, 260]);
}

export function mount(el) {
  const root = el.querySelector('.admin-root');
  if (root) bindAuthActions(root);
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export async function render() {
  const gate = await adminGate();
  if (gate.html) return { title: 'Admin sign-in', html: `<div class="admin-root">${gate.html}</div>` };

  await syncSchedules({ force: true }).catch(() => 0); // save locked schedules and ready finals
  const [events, bundles, r, chars] = await Promise.all([
    loadAllEvents(),
    loadAllBundles({ includeDrafts: true, fresh: true }),
    loadRequests().catch(() => ({ pendingTeams: [], leaves: [], claims: [] })),
    loadCharacters({ admin: true }).catch(() => ({ all: [] })),
  ]);
  const { upcoming, past } = sortEvents(events);
  const now = Date.now();
  const waiting = bundles.flatMap((b) => b.fixtures
    .filter((f) => !b.results[f.id] && f.scheduledAt && f.scheduledAt <= now && f.homeTeamId && f.awayTeamId)
    .map((f) => ({ b, f })));

  // Everything waiting on an admin, counted.
  const count = (fn) => bundles.reduce((n, b) => n + fn(b), 0);
  const fixes = count((b) => (b.corrections ?? []).filter((c) => fixPending(c, b.results[c.fixtureId])).length);
  const stats = count((b) => Object.values(b.results).filter((x) => x.statsStatus === 'pending').length);
  const disputes = count((b) => b.fixtures.filter((f) => !b.results[f.id]
    && tallyVotes((b.submissions ?? []).filter((s) => s.fixtureId === f.id), f).status === 'disputed').length);
  const newChars = chars.all.filter((c) => c.status === 'pending').length;
  const todo = [
    [fixes, '🛠', plural(fixes, 'result fix', 'result fixes'), 'Players say a score is wrong or sent a missing screenshot.', '/admin/requests'],
    [disputes, '⚖️', plural(disputes, 'score the teams disagree on', 'scores the teams disagree on'), 'Look at both votes and pick the right score.', '/admin/requests'],
    [stats, '📸', plural(stats, 'match needs its stats checked', 'matches need their stats checked'), 'Check the numbers read from the screenshot, then publish.', '/admin/stats'],
    [r.pendingTeams.length, '🛡️', plural(r.pendingTeams.length, 'new club to approve', 'new clubs to approve'), 'Say yes or no to clubs players registered.', '/admin/requests'],
    [r.claims.length, '🔗', plural(r.claims.length, 'profile claim', 'profile claims'), 'Someone says an existing profile is theirs.', '/admin/requests'],
    [r.leaves.length, '🚪', plural(r.leaves.length, 'leave request', 'leave requests'), 'Players asking to leave their club.', '/admin/requests'],
    [newChars, '🎭', plural(newChars, 'new character', 'new characters'), 'Pictures from #in-game-characters waiting to go on the Home court.', '/admin/characters'],
    [waiting.length, '⏳', plural(waiting.length, 'played match with no result', 'played matches with no result'), 'Enter the score by hand, or nudge the teams to vote.', '#needs-result'],
  ].filter(([n]) => n > 0);

  const todoHtml = todo.length
    ? `<div class="todo-grid">${todo.map(([, icon, what, why, href]) => `
        <a class="todo-card" href="${href}" ${href.startsWith('#') ? '' : 'data-link'}>
          <span class="todo-icon" aria-hidden="true">${icon}</span>
          <span><b>${esc(what)}</b><small>${esc(why)}</small></span>
          <span class="todo-go" aria-hidden="true">→</span>
        </a>`).join('')}</div>`
    : '<p class="panel all-clear">✨ All caught up. Nothing is waiting on an admin right now.</p>';

  const quick = [
    ['/admin/event/new?type=exhibition', '➕', 'New exhibition night', 'btn-primary'],
    ['/admin/event/new?type=tournament', '🏆', 'New tournament', ''],
    ['/admin/people', '👥', 'Edit a team or player', ''],
    ['/admin/help', '📜', 'Edit the FAQ & rules', ''],
  ];

  const row = (e) => `
    <a class="row" href="${urls.adminEvent(e.id)}" data-link>
      <span class="row-main"><b>${esc(e.title)}</b><span class="muted small">${esc(EVENT_TYPES[e.type]?.label)} · ${esc(eventDateLabel(e))}</span></span>
      <span class="row-side">
        ${e.published ? '<span class="tag tag-live">Public</span>' : '<span class="tag tag-draft" title="Only admins can see it">Draft (hidden)</span>'}
        ${e.status !== 'upcoming' ? `<span class="tag tag-${esc(e.status)}">${esc(EVENT_STATUSES[e.status])}</span>` : ''}
        <span class="muted small">Edit →</span>
      </span>
    </a>`;

  const name = gate.admin?.name ?? (gate.user.uid.startsWith('discord:') ? 'admin' : usernameOf(gate.user));
  return {
    title: 'Admin',
    html: `
      <div class="admin-root">
        ${adminBar(gate.user, gate.admin, '/admin')}
        <div class="page-head">
          <div><h1>Hi ${esc(name)} 👋</h1><p class="muted">${todo.length ? `${plural(todo.length, 'thing needs', 'things need')} you. Tap one to deal with it.` : 'Here’s everything you look after.'}</p></div>
        </div>
        <div class="stack">
          <section>
            <div class="section-head"><h2>Needs you</h2></div>
            ${todoHtml}
          </section>
          <section>
            <div class="section-head"><h2>Quick jobs</h2></div>
            <div class="quick-jobs">${quick.map(([href, icon, label, cls]) => `<a class="btn ${cls}" href="${href}" data-link><span aria-hidden="true">${icon}</span> ${esc(label)}</a>`).join('')}</div>
          </section>
          ${waiting.length ? `<section id="needs-result">
            <div class="section-head"><h2>Played, but no result yet</h2><span class="muted small">Tap one to enter the score</span></div>
            <div class="panel flush fixtures">${waiting.map(({ b, f }) => fixtureRow(b, f, { showEvent: true, href: urls.adminResult(b.event.id, f.id) })).join('')}</div>
          </section>` : ''}
          <section>
            <div class="section-head"><h2>Coming up</h2><span class="muted small">Tap an event to change its details, teams or fixtures</span></div>
            <div class="panel flush rows">${upcoming.map(row).join('') || '<p class="muted" style="padding:16px">No upcoming events. Make one with “New exhibition night” above.</p>'}</div>
          </section>
          ${past.length ? `<section><div class="section-head"><h2>Finished</h2></div><div class="panel flush rows">${past.map(row).join('')}</div></section>` : ''}
        </div>
      </div>`,
  };
}
