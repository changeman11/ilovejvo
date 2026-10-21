// Player profile: one season in detail (totals, averages, match log) plus career by season.
// URL option: ?season=s0 to look at an earlier season.

import { loadAllSeasons, homeSeasonId, NotFoundError } from '../data.js';
import { seasonMatches, roundLabel } from '../rules/season.js';
import { seasonPlayerStats, rates } from '../rules/stats.js';
import { esc, skeleton, notice, fmtNum, pct, teamChip, teamLink, urls } from '../ui.js';
import { statHeads, statCells, seasonPicker } from './parts.js';

export const title = 'Player';

export function loading() {
  return `<div class="grid">${skeleton([150, 80, 200, 300])}</div>`;
}

export async function render({ playerId }) {
  const [all, homeId] = await Promise.all([loadAllSeasons(), homeSeasonId()]);
  const player = all[0]?.playersById[playerId];
  if (!player) throw new NotFoundError('That player doesn’t exist');

  // Each season: their stats (if they played) and the team they're listed on (if any).
  const seasons = all.map((d) => {
    const { matches } = seasonMatches(d); // regular season + playoffs
    const statKeys = (d.season.stats ?? []).map((s) => s.key);
    const stats = seasonPlayerStats({ matches, results: d.results, statKeys }).get(playerId) ?? null;
    const rosterTeamId = Object.entries(d.rosters).find(([, r]) => r.playerIds?.includes(playerId))?.[0] ?? null;
    return { d, stats, rosterTeamId };
  });
  const involved = seasons.filter((s) => s.stats || s.rosterTeamId);

  const latest = seasons[seasons.length - 1];
  const currentTeam = latest?.rosterTeamId ? latest.d.teamsById[latest.rosterTeamId] : null;
  const colour = currentTeam?.colors?.primary ?? 'var(--accent)';
  const initial = esc((player.displayName ?? '?').trim().charAt(0).toUpperCase());

  const hero = `
    <section class="profile-hero" style="--team:${esc(colour)}">
      <div class="avatar">${initial}</div>
      <div>
        <span class="eyebrow">${player.position ? esc(player.position) : 'Player'}${player.active === false ? ' · Inactive' : ''}</span>
        <h1>${esc(player.displayName)}</h1>
        <p class="profile-sub">${currentTeam ? teamLink(currentTeam) : '<span class="muted">Free agent</span>'}</p>
      </div>
    </section>`;

  if (!involved.length) {
    return { title: player.displayName, html: hero + notice('No matches yet', ' Stats appear here after their first match.') };
  }

  const asked = new URLSearchParams(location.search).get('season');
  const focus = involved.find((s) => s.d.season.id === asked)
    ?? involved.find((s) => s.d.season.id === homeId && s.stats)
    ?? [...involved].reverse().find((s) => s.stats)
    ?? involved[involved.length - 1];
  const { d, stats } = focus;
  const statDefs = d.season.stats ?? [];
  const statKeys = statDefs.map((s) => s.key);

  const picker = seasonPicker(
    { seasons: involved.map((s) => s.d.season), season: d.season },
    urls.player(playerId)
  );

  let seasonBlock;
  if (!stats) {
    seasonBlock = notice('No matches this season', ` ${player.displayName} hasn’t played in ${d.season.name} yet.`);
  } else {
    const r = rates(stats, statKeys);
    const logRows = [...stats.log]
      .reverse()
      .map((l) => {
        const opp = d.teamsById[l.opponentId];
        const fixture = d.fixtures.find((f) => f.id === l.fixtureId);
        const res = `<span class="res ${l.won ? 'W' : 'L'}">${l.won ? 'W' : 'L'}</span> ${l.setsFor}–${l.setsAgainst}`;
        return `<tr>
          <td class="team-col"><a class="plink" href="${urls.match(d.season.id, l.fixtureId)}" data-link>${esc(roundLabel(d.season, fixture ?? { round: l.round }, { short: true }))} vs${teamChip(opp)}${esc(opp?.shortName ?? l.opponentId)}</a>${l.mvp ? ' <span class="badge">MVP</span>' : ''}</td>
          <td class="num">${res}</td>${statCells(l.line, statDefs)}</tr>`;
      })
      .join('');

    seasonBlock = `
      <section class="tiles">
        <div><b class="num">${stats.matches}</b><span>Matches</span></div>
        <div><b class="num">${pct(stats.wins, stats.matches)}</b><span>Win rate</span></div>
        <div><b class="num">${fmtNum(r.perMatch.pts ?? 0)}</b><span>PTS / match</span></div>
        <div><b class="num">${stats.mvps}</b><span>MVPs</span></div>
      </section>

      <section class="card">
        <div class="section-head"><h2>${esc(d.season.name)}</h2><span class="muted small">${stats.sets} sets played</span></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th class="team-col"></th>${statHeads(statDefs)}</tr></thead>
          <tbody>
            <tr><td class="team-col">Total</td>${statCells(stats.totals, statDefs)}</tr>
            <tr><td class="team-col">Per match</td>${statCells(r.perMatch, statDefs, (n) => fmtNum(n, 1))}</tr>
            <tr><td class="team-col">Per set</td>${statCells(r.perSet, statDefs, (n) => fmtNum(n, 2))}</tr>
          </tbody>
        </table></div>
      </section>

      <section class="card">
        <div class="section-head"><h2>Match log</h2></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th class="team-col">Match</th><th>Result</th>${statHeads(statDefs)}</tr></thead>
          <tbody>${logRows}</tbody>
        </table></div>
      </section>`;
  }

  // Career: one row per season they played, plus a total. Uses the latest season's stat list.
  const careerDefs = (latest.d.season.stats ?? statDefs);
  const played = involved.filter((s) => s.stats);
  const career = { matches: 0, wins: 0, mvps: 0, totals: Object.fromEntries(careerDefs.map((s) => [s.key, 0])) };
  const careerRows = [...played]
    .reverse()
    .map(({ d: sd, stats: st }) => {
      career.matches += st.matches;
      career.wins += st.wins;
      career.mvps += st.mvps;
      for (const s of careerDefs) career.totals[s.key] += st.totals[s.key] ?? 0;
      const teams = st.teamIds.map((id) => teamLink(sd.teamsById[id], { short: true })).join(' ');
      return `<tr><td class="team-col"><a class="plink" href="${urls.player(playerId)}?season=${encodeURIComponent(sd.season.id)}" data-link>${esc(sd.season.name)}</a></td>
        <td>${teams}</td><td class="num">${st.matches}</td><td class="num">${st.wins}</td><td class="num">${st.mvps}</td>${statCells(st.totals, careerDefs)}</tr>`;
    })
    .join('');

  const html = `
    ${hero}
    <div class="hero-row" style="margin-bottom:12px">${picker}</div>
    <div class="grid">
      ${seasonBlock}
      ${played.length ? `
      <section class="card">
        <div class="section-head"><h2>Career</h2></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th class="team-col">Season</th><th>Team</th><th title="Matches">M</th><th title="Wins">W</th><th title="Match MVPs">MVP</th>${statHeads(careerDefs)}</tr></thead>
          <tbody>${careerRows}</tbody>
          ${played.length > 1 ? `<tfoot><tr><td class="team-col">Career</td><td></td><td class="num">${career.matches}</td><td class="num">${career.wins}</td><td class="num">${career.mvps}</td>${statCells(career.totals, careerDefs)}</tr></tfoot>` : ''}
        </table></div>
      </section>` : ''}
    </div>`;

  return { title: player.displayName, html };
}
