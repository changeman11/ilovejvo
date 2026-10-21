// Admin "Match day": what needs a result, what needs checking, what's coming, what's done.

import { loadSeasonFromUrl } from '../../data.js';
import { reviewResult } from '../../rules/results.js';
import { formatFor } from '../../rules/season.js';
import { bracketProblems } from '../../rules/playoffs.js';
import { esc, skeleton, urls } from '../../ui.js';
import { matchRow, seasonPicker, sortByTime } from '../parts.js';
import { adminGate, adminBar, bindAuthActions } from './gate.js';

export const title = 'Admin';

export function loading() {
  return `<div class="grid">${skeleton([60, 200, 200])}</div>`;
}

export function mount(el) {
  const root = el.querySelector('.admin-root');
  if (root) bindAuthActions(root);
}

function section(heading, sub, rows, empty) {
  return `
    <section class="card">
      <div class="section-head"><h2>${heading}</h2>${sub ? `<span class="muted small">${sub}</span>` : ''}</div>
      ${rows.length ? `<div class="matches">${rows.join('')}</div>` : `<p class="muted">${empty}</p>`}
    </section>`;
}

export async function render() {
  const gate = await adminGate();
  if (gate.html) return { title: 'Admin sign-in', html: `<div class="admin-root">${gate.html}</div>` };

  const data = await loadSeasonFromUrl({ fresh: true });
  const now = Date.now();
  const fixtures = [...data.fixtures].sort(sortByTime);
  const teamNames = Object.fromEntries(data.teams.map((t) => [t.id, t.name]));
  const edit = (f) => urls.adminResult(data.season.id, f.id);

  const overdue = fixtures.filter((f) => !data.results[f.id] && (f.scheduledAt ?? Infinity) <= now);
  const upcoming = fixtures.filter((f) => !data.results[f.id] && (f.scheduledAt ?? Infinity) > now).slice(0, 6);
  const done = fixtures.filter((f) => data.results[f.id]);

  const bracketIssues = bracketProblems(data.season, data.fixtures, data.results);
  const flagged = done
    .map((f) => {
      const review = reviewResult(data.results[f.id], {
        homeTeamId: f.homeTeamId,
        awayTeamId: f.awayTeamId,
        format: formatFor(data.season, f),
        teamSize: data.season.format?.teamSize ?? 4,
        rosters: data.rosters,
        teamNames,
      });
      for (const p of bracketIssues.filter((b) => b.fixtureId === f.id)) review.errors.push(p.message);
      return { f, review };
    })
    .filter(({ review }) => review.errors.length || review.warnings.length);

  const flaggedRows = flagged.map(({ f, review }) => `
    <div class="flagged">
      ${matchRow(f, data, { href: edit(f), showRound: true })}
      <ul class="flags">
        ${review.errors.map((e) => `<li class="err">${esc(e)}</li>`).join('')}
        ${review.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}
      </ul>
    </div>`);

  const html = `
    <div class="admin-root">
      ${adminBar(gate.user, gate.admin)}
      <section class="hero hero-row">
        <div>
          <span class="eyebrow">Admin · ${esc(data.season.name)}</span>
          <h1>Match day</h1>
        </div>
        ${seasonPicker(data, '/admin')}
      </section>
      <nav class="admin-tools" aria-label="Admin tools">
        <a class="btn btn-ghost btn-sm" href="/admin/playoffs?season=${encodeURIComponent(data.season.id)}" data-link>Playoffs</a>
      </nav>
      <div class="grid">
        ${section('Needs a result', overdue.length ? `${overdue.length} waiting` : '', overdue.map((f) => matchRow(f, data, { href: edit(f), showRound: true })), 'All caught up. Every played match has a result.')}
        ${section('Something to check', flagged.length ? `${flagged.length} result${flagged.length === 1 ? '' : 's'}` : '', flaggedRows, 'Nothing to check.')}
        ${section('Coming up', '', upcoming.map((f) => matchRow(f, data, { href: edit(f), showRound: true })), 'No upcoming fixtures.')}
        ${section('Recent results', 'Tap to edit', [...done].reverse().slice(0, 10).map((f) => matchRow(f, data, { href: edit(f), showRound: true })), 'No results yet.')}
      </div>
    </div>`;
  return { title: 'Match day', html };
}
