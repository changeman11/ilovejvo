// Match page: score, set-by-set, box scores, MVP, VOD and screenshots.
// Upcoming matches show a preview instead: table positions, form, earlier meetings.

import { loadSeason, NotFoundError } from '../data.js';
import { checkResult } from '../rules/match.js';
import { computeStandings } from '../rules/standings.js';
import {
  esc, skeleton, notice, safeUrl, fmtLongDay, fmtTime, teamChip, playerLink, formPills, urls,
} from '../ui.js';
import { matchRow, statHeads, statCells, sortByTime } from './parts.js';

export const title = 'Match';

export function loading() {
  return `<div class="grid">${skeleton([180, 160, 260, 260])}</div>`;
}

function boxScore(teamId, result, data) {
  const team = data.teamsById[teamId];
  const statDefs = data.season.stats ?? [];
  const lines = Object.entries(result.playerStats ?? {})
    .filter(([, s]) => s.teamId === teamId)
    .sort((a, b) => (b[1].pts ?? 0) - (a[1].pts ?? 0));
  if (!lines.length) return '';

  const totals = {};
  for (const s of statDefs) totals[s.key] = lines.reduce((n, [, l]) => n + (Number(l[s.key]) || 0), 0);

  const rows = lines
    .map(([pid, line]) => {
      const mvp = result.mvpPlayerId === pid ? ' <span class="badge" title="Match MVP">MVP</span>' : '';
      return `<tr><td class="team-col">${playerLink(data.playersById[pid], pid)}${mvp}</td>${statCells(line, statDefs)}</tr>`;
    })
    .join('');

  return `
    <section class="card">
      <div class="section-head"><h2 class="with-chip">${teamChip(team, 'lg')}${esc(team?.name ?? teamId)}</h2></div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th class="team-col">Player</th>${statHeads(statDefs)}</tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td class="team-col">Team</td>${statCells(totals, statDefs)}</tr></tfoot>
        </table>
      </div>
    </section>`;
}

function setsCard(result, check, home, away) {
  const rows = result.sets
    .map((s, i) => {
      const hw = s.home > s.away;
      return `<tr><td>Set ${i + 1}</td><td class="num ${hw ? 'win' : ''}">${s.home}</td><td class="num ${hw ? '' : 'win'}">${s.away}</td></tr>`;
    })
    .join('');
  return `
    <section class="card">
      <div class="section-head"><h2>Sets</h2></div>
      <table class="data sets-table">
        <thead><tr><th></th><th>${esc(home?.shortName ?? 'Home')}</th><th>${esc(away?.shortName ?? 'Away')}</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td>Points</td><td class="num">${check.homePoints}</td><td class="num">${check.awayPoints}</td></tr></tfoot>
      </table>
    </section>`;
}

function mvpCard(result, data) {
  const pid = result.mvpPlayerId;
  if (!pid) return '';
  const line = result.playerStats?.[pid];
  const team = data.teamsById[line?.teamId];
  const statDefs = data.season.stats ?? [];
  const highlights = statDefs
    .filter((s) => line?.[s.key])
    .slice(0, 4)
    .map((s) => `<div><b class="num">${esc(line[s.key])}</b><span>${esc(s.label)}</span></div>`)
    .join('');
  return `
    <section class="card mvp">
      <span class="eyebrow">Match MVP</span>
      <div class="mvp-name">${teamChip(team, 'lg')}${playerLink(data.playersById[pid], pid)}</div>
      ${highlights ? `<div class="mini-stats">${highlights}</div>` : ''}
    </section>`;
}

function mediaCard(result) {
  const vod = safeUrl(result.vodUrl);
  const shots = (result.screenshots ?? []).map(safeUrl).filter(Boolean);
  if (!vod && !shots.length) return '';
  return `
    <section class="card">
      <div class="section-head"><h2>Media</h2></div>
      ${vod ? `<a class="btn" href="${esc(vod)}" target="_blank" rel="noopener">▶ Watch the VOD</a>` : ''}
      ${shots.length ? `<div class="shots">${shots.map((s, i) => `<a href="${esc(s)}" target="_blank" rel="noopener"><img src="${esc(s)}" alt="Screenshot ${i + 1}" loading="lazy"></a>`).join('')}</div>` : ''}
    </section>`;
}

function previewCard(fixture, data) {
  const { rows } = computeStandings(data);
  const line = (teamId) => {
    const r = rows.find((x) => x.teamId === teamId);
    const team = data.teamsById[teamId];
    if (!r) return '';
    return `<tr><td class="team-col"><span class="team">${teamChip(team)}${esc(team?.name)}</span></td>
      <td class="num">${r.rank}</td><td class="num">${r.wins}–${r.losses}</td><td class="num pts">${r.points}</td><td>${formPills(r.form)}</td></tr>`;
  };
  const meetings = data.fixtures
    .filter((f) => f.id !== fixture.id && data.results[f.id]
      && [f.homeTeamId, f.awayTeamId].includes(fixture.homeTeamId)
      && [f.homeTeamId, f.awayTeamId].includes(fixture.awayTeamId))
    .sort(sortByTime);
  return `
    <section class="card">
      <div class="section-head"><h2>Form guide</h2></div>
      <div class="table-wrap"><table class="data">
        <thead><tr><th class="team-col">Team</th><th>Pos</th><th>W–L</th><th>Pts</th><th>Form</th></tr></thead>
        <tbody>${line(fixture.homeTeamId)}${line(fixture.awayTeamId)}</tbody>
      </table></div>
    </section>
    <section class="card">
      <div class="section-head"><h2>Earlier this season</h2></div>
      ${meetings.length ? `<div class="matches">${meetings.map((f) => matchRow(f, data, { showRound: true })).join('')}</div>` : '<p class="muted">First meeting this season.</p>'}
    </section>`;
}

export async function render({ seasonId, fixtureId }) {
  const data = await loadSeason(seasonId);
  const fixture = data.fixtures.find((f) => f.id === fixtureId);
  if (!fixture) throw new NotFoundError('That match doesn’t exist');

  const home = data.teamsById[fixture.homeTeamId];
  const away = data.teamsById[fixture.awayTeamId];
  const result = data.results[fixture.id];
  const check = result ? checkResult(result.sets, data.season.format) : null;
  const played = check?.ok;

  const teamBlock = (team, side, won) => `
    <a class="mh-team ${side} ${played ? (won ? 'won' : 'lost') : ''}" href="${team ? urls.team(team.id) : '#'}" data-link>
      ${teamChip(team, 'xl')}
      <span class="mh-name">${esc(team?.name ?? 'TBC')}</span>
    </a>`;

  const middle = played
    ? `<div class="mh-score num">${check.homeSets}<span>–</span>${check.awaySets}</div>`
    : `<div class="mh-vs"><b>VS</b><span>${fmtTime(fixture.scheduledAt)}</span></div>`;

  const status = played ? 'Final' : result ? 'Result under review' : 'Upcoming';

  let body;
  if (played) {
    body = `
      <div class="grid grid-match">
        ${setsCard(result, check, home, away)}
        ${mvpCard(result, data)}
      </div>
      ${boxScore(fixture.homeTeamId, result, data)}
      ${boxScore(fixture.awayTeamId, result, data)}
      ${mediaCard(result)}`;
  } else if (result) {
    body = notice('Result under review', ' This score doesn’t pass the season’s rules yet, so an admin is checking it.');
  } else {
    body = previewCard(fixture, data);
  }

  const backHref = `/fixtures?season=${encodeURIComponent(seasonId)}&round=${encodeURIComponent(fixture.round)}`;
  return {
    title: `${home?.shortName ?? 'TBC'} vs ${away?.shortName ?? 'TBC'}`,
    html: `
      <a class="back" href="${esc(backHref)}" data-link>← Round ${esc(fixture.round)}</a>
      <section class="match-hero" style="--home:${esc(home?.colors?.primary ?? 'transparent')};--away:${esc(away?.colors?.primary ?? 'transparent')}">
        <span class="eyebrow">${esc(data.season.name)} · Round ${esc(fixture.round)} · ${status}</span>
        <div class="mh-teams">
          ${teamBlock(home, 'home', check?.winner === 'home')}
          ${middle}
          ${teamBlock(away, 'away', check?.winner === 'away')}
        </div>
        <p class="mh-meta">${fmtLongDay(fixture.scheduledAt)}${fixture.scheduledAt ? ` · ${fmtTime(fixture.scheduledAt)}` : ''}</p>
      </section>
      <div class="grid">${body}</div>`,
  };
}
