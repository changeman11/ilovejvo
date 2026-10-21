import { loadHomeSeason } from '../data.js';
import { computeStandings } from '../rules/standings.js';
import { seasonMatches } from '../rules/season.js';
import { seasonPlayerStats, leaders } from '../rules/stats.js';
import { esc, skeleton, teamChip, playerLink } from '../ui.js';
import { matchRow, standingsTable, sortByTime } from './parts.js';

export const title = 'League';

// Which stats get a "league leaders" spot, in order (only those the season tracks).
const LEADER_STATS = ['pts', 'spk', 'blk', 'ace', 'dig', 'ast'];

export function loading() {
  return `<div class="grid">${skeleton([90, 76, 320, 260])}</div>`;
}

function leadersCard(data, matches) {
  const statDefs = (data.season.stats ?? []).filter((s) => LEADER_STATS.includes(s.key));
  if (!statDefs.length || !matches.length) return '';
  const statKeys = (data.season.stats ?? []).map((s) => s.key);
  const players = seasonPlayerStats({ matches, results: data.results, statKeys });

  const blocks = statDefs
    .sort((a, b) => LEADER_STATS.indexOf(a.key) - LEADER_STATS.indexOf(b.key))
    .map((s) => {
      const top = leaders(players, s.key, { limit: 3 });
      if (!top.length || top[0].value === 0) return '';
      const list = top
        .map((p, i) => {
          const teamId = p.log[p.log.length - 1]?.teamId;
          return `<li class="${i === 0 ? 'first' : ''}">${teamChip(data.teamsById[teamId])}${playerLink(data.playersById[p.playerId], p.playerId)}<b class="num">${p.value}</b></li>`;
        })
        .join('');
      return `<div class="leader"><h3 title="${esc(s.name)}">${esc(s.name)}</h3><ol>${list}</ol></div>`;
    })
    .join('');

  return blocks
    ? `<section class="card"><div class="section-head"><h2>League leaders</h2><span class="muted small">Season totals</span></div><div class="leaders">${blocks}</div></section>`
    : '';
}

export async function render() {
  const data = await loadHomeSeason();
  const { rows } = computeStandings(data);
  const { matches } = seasonMatches(data); // regular season + playoffs
  const played = matches.filter((m) => !m.forfeit);

  const setsPlayed = played.reduce((n, m) => n + m.homeSets + m.awaySets, 0);
  const pointsScored = played.reduce((n, m) => n + m.homePoints + m.awayPoints, 0);
  const deuceSets = played
    .flatMap((m) => data.results[m.fixtureId].sets)
    .filter((s) => Math.max(s.home, s.away) > data.season.format.pointsPerSet).length;

  const byId = Object.fromEntries(data.fixtures.map((f) => [f.id, f]));
  const latest = [...matches].reverse().slice(0, 4).map((m) => byId[m.fixtureId]);
  const upcoming = data.fixtures.filter((f) => !data.results[f.id]).sort(sortByTime).slice(0, 4);

  const status = data.season.status === 'live'
    ? '<span class="live-dot"></span>Live'
    : esc(data.season.status ?? '');

  return `
    <section class="hero">
      <p class="callout">League preview: hidden from the public. Only admins can see this.</p>
      <nav class="chips" aria-label="League pages">
        ${[['/table', 'Table'], ['/fixtures', 'Fixtures'], ['/teams', 'Teams'], ['/stats', 'Stats'], ['/playoffs', 'Playoffs'], ['/admin/matchday', 'Match day']]
          .map(([href, label]) => `<a class="chip-link done" href="${href}" data-link>${label}</a>`).join('')}
      </nav>
      <span class="eyebrow">${status} · ${esc(data.season.name)}</span>
      <h1>Just Volleyball <span>Oceania</span></h1>
    </section>

    <section class="pulse" aria-label="Season pulse">
      <div><b class="num">${matches.length}<small class="muted">/${data.fixtures.length}</small></b><span>Matches</span></div>
      <div><b class="num">${setsPlayed}</b><span>Sets</span></div>
      <div><b class="num">${pointsScored}</b><span>Points</span></div>
      <div><b class="num">${deuceSets}</b><span>Deuce sets</span></div>
    </section>

    <div class="grid grid-home">
      <div class="grid">
        <section class="card">
          <div class="section-head"><h2>Standings</h2><a href="/table" data-link>Full table →</a></div>
          ${standingsTable(rows, data, { compact: true })}
        </section>
        ${leadersCard(data, matches)}
      </div>

      <div class="grid">
        <section class="card">
          <div class="section-head"><h2>Latest results</h2><a href="/fixtures" data-link>All →</a></div>
          <div class="matches">${latest.map((f) => matchRow(f, data)).join('') || '<p class="muted">No results yet.</p>'}</div>
        </section>
        <section class="card">
          <div class="section-head"><h2>Up next</h2></div>
          <div class="matches">${upcoming.map((f) => matchRow(f, data)).join('') || '<p class="muted">No fixtures scheduled.</p>'}</div>
        </section>
      </div>
    </div>`;
}
