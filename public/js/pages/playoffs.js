// Playoffs: the bracket, or the projected one until an admin creates it.

import { loadSeasonFromUrl } from '../data.js';
import { esc, skeleton } from '../ui.js';
import { seasonPicker } from './parts.js';
import { bracketView } from './bracket.js';

export const title = 'Playoffs';

export function loading() {
  return `<div class="grid">${skeleton([60, 320])}</div>`;
}

export async function render() {
  const data = await loadSeasonFromUrl();
  const { html, projected } = bracketView(data);
  const left = data.fixtures.filter((f) => f.stage !== 'playoffs' && !data.results[f.id]).length;
  const rounds = data.season.playoffs?.rounds ?? [];
  const formatNote = rounds.map((r) => `${r.name}: best of ${r.bestOf}`).join(' · ');

  return `
    <section class="hero hero-row">
      <div>
        <span class="eyebrow">${esc(data.season.name)}</span>
        <h1>Playoffs</h1>
      </div>
      ${seasonPicker(data, '/playoffs')}
    </section>
    ${projected ? `<p class="callout"><b>If the season ended today.</b> ${left ? `${left} regular-season match${left === 1 ? '' : 'es'} left, so this can still change.` : 'The regular season is done; the bracket is set once an admin locks it in.'}</p>` : ''}
    <section class="card">${html}</section>
    ${formatNote ? `<p class="muted small">${esc(formatNote)}. Higher seed is the home team. Every set to 10, win by 2.</p>` : ''}`;
}
