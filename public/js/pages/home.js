import { loadHomeSeason } from '../data.js';
import { computeStandings } from '../rules/standings.js';
import { seasonPlayerStats, leaders } from '../rules/stats.js';
import { esc, skeleton, teamChip, playerLink } from '../ui.js';
import { matchRow, standingsTable, sortByTime } from './parts.js';

export const title = 'Home';

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
  const { rows, matches } = computeStandings(data);

  const setsPlayed = matches.reduce((n, m) => n + m.homeSets + m.awaySets, 0);
  const pointsScored = matches.reduce((n, m) => n + m.homePoints + m.awayPoints, 0);
  const deuceSets = matches
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
