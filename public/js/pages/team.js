// Team profile: this season (record, roster, stats, matches) and season-by-season history.

import { loadAllSeasons, homeSeasonId, NotFoundError } from '../data.js';
import { computeStandings } from '../rules/standings.js';
import { seasonPlayerStats, seasonTeamStats, rates } from '../rules/stats.js';
import { esc, skeleton, notice, fmtRatio, fmtNum, ordinal, teamChip, playerLink, formPills } from '../ui.js';
import { matchRow, statHeads, statCells, sortByTime } from './parts.js';

export const title = 'Team';

export function loading() {
  return `<div class="grid">${skeleton([150, 80, 300, 240])}</div>`;
}

export async function render({ teamId }) {
  const [all, homeId] = await Promise.all([loadAllSeasons(), homeSeasonId()]);
  const team = all[0]?.teamsById[teamId];
  if (!team) throw new NotFoundError('That team doesn’t exist');

  const seasonsIn = all.filter((d) => d.teams.some((t) => t.id === teamId));
  const history = seasonsIn.map((d) => {
    const standing = computeStandings(d);
    return { d, ...standing, row: standing.rows.find((r) => r.teamId === teamId) };
  });
  const focus = history.find((h) => h.d.season.id === homeId) ?? history[history.length - 1];
  const colour = team.colors?.primary ?? 'var(--accent)';

  const hero = (extra = '') => `
    <section class="profile-hero" style="--team:${esc(colour)}">
      ${teamChip(team, 'xxl')}
      <div>
        <span class="eyebrow">${esc(team.shortName ?? '')}${focus ? ` · ${esc(focus.d.season.name)}` : ''}</span>
        <h1>${esc(team.name)}</h1>
        ${extra}
      </div>
    </section>`;

  if (!focus) {
    return { title: team.name, html: hero() + notice('No seasons yet', ' This team hasn’t played in a season.') };
  }

  const { d, row, matches } = focus;
  const statDefs = d.season.stats ?? [];
  const statKeys = statDefs.map((s) => s.key);

  // Roster: everyone listed for this season, plus anyone who played for the team and has since left.
  const players = seasonPlayerStats({ matches, results: d.results, statKeys, teamId });
  const roster = d.rosters[teamId] ?? { playerIds: [] };
  const ids = [...new Set([...(roster.playerIds ?? []), ...players.keys()])];
  const rosterRows = ids
    .map((pid) => ({ pid, p: players.get(pid), listed: roster.playerIds?.includes(pid) }))
    .sort((a, b) => (b.p?.totals.pts ?? -1) - (a.p?.totals.pts ?? -1))
    .map(({ pid, p, listed }) => {
      const badges = [
        roster.captainId === pid ? '<span class="badge" title="Captain">C</span>' : '',
        listed ? '' : '<span class="badge muted-badge" title="No longer on the roster">Left</span>',
      ].join('');
      return `<tr><td class="team-col">${playerLink(d.playersById[pid], pid)}${badges}</td>
        <td class="num">${p?.matches ?? 0}</td><td class="num">${p?.mvps ?? 0}</td>${statCells(p?.totals, statDefs)}</tr>`;
    })
    .join('');

  const teamStats = seasonTeamStats({ matches, results: d.results, statKeys }).get(teamId);
  const teamRates = teamStats ? rates(teamStats, statKeys) : null;

  const mine = d.fixtures.filter((f) => f.homeTeamId === teamId || f.awayTeamId === teamId).sort(sortByTime);
  const upcoming = mine.filter((f) => !d.results[f.id]).slice(0, 3);
  const results = mine.filter((f) => d.results[f.id]).reverse();

  const historyRows = [...history]
    .reverse()
    .map((h) => `<tr><td class="team-col"><a class="plink" href="/table?season=${encodeURIComponent(h.d.season.id)}" data-link>${esc(h.d.season.name)}</a></td>
      <td class="num">${h.row ? ordinal(h.row.rank) : '–'}</td><td class="num">${h.row?.played ?? 0}</td><td class="num">${h.row?.wins ?? 0}</td>
      <td class="num">${h.row?.losses ?? 0}</td><td class="num pts">${h.row?.points ?? 0}</td><td class="num">${h.row ? `${h.row.setsWon}–${h.row.setsLost}` : '–'}</td></tr>`)
    .join('');

  const html = `
    ${hero(`<p class="profile-sub">${ordinal(row.rank)} · ${row.wins}W ${row.losses}L · ${row.points} pts ${formPills(row.form)}</p>`)}

    <section class="tiles">
      <div><b class="num">${ordinal(row.rank)}</b><span>Position</span></div>
      <div><b class="num">${row.wins}–${row.losses}</b><span>Record</span></div>
      <div><b class="num">${row.setsWon}–${row.setsLost}</b><span>Sets</span></div>
      <div><b class="num">${fmtRatio(row.pointRatio)}</b><span>Point ratio</span></div>
    </section>

    <div class="grid">
      <section class="card">
        <div class="section-head"><h2>Roster</h2><span class="muted small">${esc(d.season.name)} totals</span></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th class="team-col">Player</th><th title="Matches">M</th><th title="Match MVPs">MVP</th>${statHeads(statDefs)}</tr></thead>
          <tbody>${rosterRows || `<tr><td class="team-col muted" colspan="${3 + statDefs.length}">No players listed.</td></tr>`}</tbody>
        </table></div>
      </section>

      ${teamStats ? `
      <section class="card">
        <div class="section-head"><h2>Team stats</h2><span class="muted small">${row.pointsWon}–${row.pointsLost} points</span></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th class="team-col"></th>${statHeads(statDefs)}</tr></thead>
          <tbody>
            <tr><td class="team-col">Total</td>${statCells(teamStats.totals, statDefs)}</tr>
            <tr><td class="team-col">Per match</td>${statCells(teamRates.perMatch, statDefs, (n) => fmtNum(n, 1))}</tr>
            <tr><td class="team-col">Per set</td>${statCells(teamRates.perSet, statDefs, (n) => fmtNum(n, 2))}</tr>
          </tbody>
        </table></div>
      </section>` : ''}

      <div class="grid grid-2">
        <section class="card">
          <div class="section-head"><h2>Results</h2></div>
          <div class="matches">${results.map((f) => matchRow(f, d, { showRound: true })).join('') || '<p class="muted">No results yet.</p>'}</div>
        </section>
        <section class="card">
          <div class="section-head"><h2>Up next</h2><a href="/fixtures?season=${encodeURIComponent(d.season.id)}&team=${encodeURIComponent(teamId)}" data-link>All fixtures →</a></div>
          <div class="matches">${upcoming.map((f) => matchRow(f, d, { showRound: true })).join('') || '<p class="muted">Nothing scheduled.</p>'}</div>
        </section>
      </div>

      <section class="card">
        <div class="section-head"><h2>History</h2></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th class="team-col">Season</th><th>Pos</th><th>P</th><th>W</th><th>L</th><th>Pts</th><th>Sets</th></tr></thead>
          <tbody>${historyRows}</tbody>
        </table></div>
      </section>
    </div>`;

  return { title: team.name, html };
}
