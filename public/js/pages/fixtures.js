// Fixtures & results across every published event.
// URL options: ?view=upcoming|results  ?event=<id>

import { loadAllBundles } from '../data.js';
import { esc, skeleton, notice, pageTitle } from '../ui.js';
import { allFixtures, fixturesByDay, resultOf } from './parts.js';

export const title = 'Fixtures';

export function loading() {
  return skeleton([60, 44, 360]);
}

export async function render() {
  const params = new URLSearchParams(location.search);
  const view = params.get('view') === 'results' ? 'results' : 'upcoming';
  const bundles = await loadAllBundles();
  const eventId = bundles.some((b) => b.event.id === params.get('event')) ? params.get('event') : null;

  const items = allFixtures(eventId ? bundles.filter((b) => b.event.id === eventId) : bundles);
  const upcoming = items.filter(({ b, f }) => !b.results[f.id]);
  const results = items.filter(({ b, f }) => resultOf(b, f).result).reverse(); // newest first
  const shown = view === 'results' ? results : upcoming;

  const url = (changes) => {
    const q = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(changes)) (v ? q.set(k, v) : q.delete(k));
    const s = q.toString();
    return `/fixtures${s ? `?${s}` : ''}`;
  };
  const chip = (v, label, count) => `<a class="chip-link" href="${esc(url({ view: v === 'upcoming' ? null : v }))}" data-link data-keep-scroll${v === view ? ' aria-current="true"' : ''}>${label} <span class="muted">&nbsp;${count}</span></a>`;
  const eventOptions = [
    `<option value="${esc(url({ event: null }))}">All events</option>`,
    ...bundles.map((b) => `<option value="${esc(url({ event: b.event.id }))}"${b.event.id === eventId ? ' selected' : ''}>${esc(b.event.title)}</option>`),
  ].join('');

  return `
    <div class="page-head">
      ${pageTitle('Fixtures', 'Every match across exhibition nights and tournaments. Times are in your time zone.', 'teal')}
      ${bundles.length > 1 ? `<label class="picker"><span class="sr-only">Event</span><select data-nav>${eventOptions}</select></label>` : ''}
    </div>
    <nav class="chips">${chip('upcoming', 'Upcoming', upcoming.length)}${chip('results', 'Results', results.length)}</nav>
    ${shown.length
      ? `<div class="panel flush fixtures">${fixturesByDay(shown, { showEvent: !eventId })}</div>`
      : notice(view === 'results' ? 'No results yet' : 'Nothing scheduled', view === 'results' ? ' Results appear here once matches are played.' : ' New fixtures will show up here.', 'x')}`;
}
