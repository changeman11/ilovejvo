// Player stats: one sortable table, across all events or one event.
// URL options: ?event=<id>  ?per=total|match|set  ?sort=<stat key>

import { loadAllBundles } from '../data.js';
import { seasonMatches } from '../rules/season.js';
import { esc, skeleton, notice, fmtNum, pct, teamDot, playerLink } from '../ui.js';
import { careerStats, statDefsFor, statValue } from './career.js';

export const title = 'Stats';

export function loading() {
  return skeleton([60, 90, 420]);
}

const PERS = [['total', 'Totals'], ['match', 'Per match'], ['set', 'Per set']];

export async function render() {
  const params = new URLSearchParams(location.search);
  const all = await loadAllBundles();
  const eventId = all.some((b) => b.event.id === params.get('event')) ? params.get('event') : null;
  const bundles = eventId ? all.filter((b) => b.event.id === eventId) : all;
  const mode = PERS.some(([v]) => v === params.get('per')) ? params.get('per') : 'total';
  const defs = statDefsFor(bundles);
  const stats = careerStats(bundles);
  const people = all[0]; // any bundle has the full team/player lists

  const url = (changes) => {
    const q = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(changes)) (v ? q.set(k, v) : q.delete(k));
    const s = q.toString();
    return `/stats${s ? `?${s}` : ''}`;
  };

  if (!stats.size) {
    return `<div class="page-head"><h1>Player stats</h1></div>${notice('No stats yet', ' Stats appear once the first results are in.')}`;
  }

  // League-wide numbers for the tiles.
  const matches = bundles.flatMap((b) => seasonMatches(b).matches).filter((m) => !m.forfeit);
  const sets = matches.reduce((n, m) => n + m.homeSets + m.awaySets, 0);
  const points = matches.reduce((n, m) => n + m.homePoints + m.awayPoints, 0);

  // Columns: MVPs (totals only), then every stat.
  const cols = [
    ...(mode === 'total' ? [{ key: 'mvps', label: 'MVP', name: 'Match MVPs' }] : []),
    ...defs,
  ];
  const sortKey = cols.some((c) => c.key === params.get('sort')) ? params.get('sort') : 'pts';
  const maxMatches = Math.max(...[...stats.values()].map((p) => p.matches));
  const minMatches = mode === 'total' ? 1 : Math.max(1, Math.ceil(maxMatches * 0.4));
  const fmt = (v) => (mode === 'total' ? String(v) : fmtNum(v, mode === 'set' ? 2 : 1));

  const rows = [...stats.values()]
    .filter((p) => p.matches >= minMatches)
    .sort((a, b) => statValue(b, sortKey, mode) - statValue(a, sortKey, mode) || a.matches - b.matches || a.playerId.localeCompare(b.playerId));

  const head = cols.map((c) => `<th title="${esc(c.name)}"${c.key === sortKey ? ' aria-sort="descending"' : ''}><a href="${esc(url({ sort: c.key }))}" data-link data-keep-scroll>${esc(c.label)}${c.key === sortKey ? ' ↓' : ''}</a></th>`).join('');
  const body = rows.map((p, i) => {
    const team = people.teamsById[p.log[p.log.length - 1]?.teamId];
    return `<tr>
      <td class="first"><span class="rank">${i + 1}</span><span class="team">${teamDot(team)}${playerLink(people.playersById[p.playerId], p.playerId)}</span></td>
      <td>${p.matches}</td><td>${pct(p.wins, p.matches)}</td>
      ${cols.map((c) => `<td class="${c.key === sortKey ? 'sorted' : ''}">${fmt(statValue(p, c.key, mode))}</td>`).join('')}
    </tr>`;
  }).join('');

  const eventOptions = [
    `<option value="${esc(url({ event: null }))}">All events</option>`,
    ...all.map((b) => `<option value="${esc(url({ event: b.event.id }))}"${b.event.id === eventId ? ' selected' : ''}>${esc(b.event.title)}</option>`),
  ].join('');

  return `
    <div class="page-head">
      <div><h1>Player stats</h1><p class="muted">${eventId ? esc(bundles[0].event.title) : 'All events combined'}. Tap a column to sort.</p></div>
      ${all.length > 1 ? `<label class="picker"><span class="sr-only">Event</span><select data-nav>${eventOptions}</select></label>` : ''}
    </div>
    <div class="stack">
      <div class="tiles">
        <div class="tile"><b>${matches.length}</b><span>Matches</span></div>
        <div class="tile"><b>${sets}</b><span>Sets</span></div>
        <div class="tile"><b>${points}</b><span>Points scored</span></div>
        <div class="tile"><b>${stats.size}</b><span>Players</span></div>
      </div>
      <div>
        <nav class="chips">${PERS.map(([v, label]) => `<a class="chip-link" href="${esc(url({ per: v === 'total' ? null : v }))}" data-link data-keep-scroll${v === mode ? ' aria-current="true"' : ''}>${label}</a>`).join('')}</nav>
        ${mode !== 'total' ? `<p class="muted small" style="margin-bottom:8px">Averages include players with at least ${minMatches} match${minMatches === 1 ? '' : 'es'}.</p>` : ''}
        <div class="panel flush">
          <div class="table-wrap"><table class="data">
            <thead><tr><th class="first">Player</th><th title="Matches">M</th><th title="Matches won">Win</th>${head}</tr></thead>
            <tbody>${body}</tbody>
          </table></div>
        </div>
      </div>
    </div>`;
}
