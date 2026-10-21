import { loadSeasonFromUrl } from '../data.js';
import { computeStandings } from '../rules/standings.js';
import { esc, skeleton } from '../ui.js';
import { standingsTable, seasonPicker } from './parts.js';

export const title = 'Table';

export function loading() {
  return `<div class="grid">${skeleton([60, 380])}</div>`;
}

export async function render() {
  const data = await loadSeasonFromUrl();
  const { rows } = computeStandings(data);
  const t = data.season.standings?.tiebreakers ?? [];
  const names = { points: 'points', wins: 'wins', setRatio: 'set ratio', pointRatio: 'point ratio', h2h: 'head-to-head' };

  return `
    <section class="hero hero-row">
      <div>
        <span class="eyebrow">${esc(data.season.name)}</span>
        <h1>Table</h1>
      </div>
      ${seasonPicker(data, '/table')}
    </section>
    <section class="card">
      ${standingsTable(rows, data)}
      <p class="muted small" style="margin:12px 0 0">
        Ranked by ${t.map((k) => names[k] ?? k).join(' → ')}.
        SR = set ratio, PR = point ratio.
      </p>
    </section>`;
}
