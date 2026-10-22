// Match page: score, sets, MVP, box scores, VOD and screenshots.

import { loadEventBundle, NotFoundError } from '../data.js';
import { esc, skeleton, notice, safeUrl, fmtDay, fmtTime, teamDot, teamLink, playerLink, urls } from '../ui.js';
import { formatFor } from '../rules/season.js';
import { resultOf, statHeads, statCells } from './parts.js';
import { votesSummary, reportBlock, mountReport } from './report.js';
import { mediaUrl } from '../media.js';

export const title = 'Match';

export function loading() {
  return skeleton([220, 260]);
}

function boxScore(b, teamId, result) {
  const team = b.teamsById[teamId];
  const defs = b.season.stats ?? [];
  const lines = Object.entries(result.playerStats ?? {})
    .filter(([, s]) => s.teamId === teamId)
    .sort((x, y) => (y[1].pts ?? 0) - (x[1].pts ?? 0));
  if (!lines.length) return '';
  const totals = Object.fromEntries(defs.map((d) => [d.key, lines.reduce((n, [, l]) => n + (Number(l[d.key]) || 0), 0)]));
  return `
    <section>
      <div class="section-head"><h2>${team ? teamLink(team, { size: 'lg' }) : esc(teamId)}</h2></div>
      <div class="panel flush"><div class="table-wrap"><table class="data">
        <thead><tr><th class="first">Player</th>${statHeads(defs)}</tr></thead>
        <tbody>${lines.map(([pid, line]) => `<tr><td class="first">${playerLink(b.playersById[pid], pid)}${result.mvpPlayerId === pid ? '<span class="badge">MVP</span>' : ''}</td>${statCells(line, defs)}</tr>`).join('')}</tbody>
        <tfoot><tr><td class="first">Team</td>${statCells(totals, defs)}</tr></tfoot>
      </table></div></div>
    </section>`;
}

export async function render({ eventId, fixtureId }) {
  const b = await loadEventBundle(eventId);
  const f = b.fixtures.find((x) => x.id === fixtureId);
  if (!f) throw new NotFoundError('That match doesn’t exist');
  const home = b.teamsById[f.homeTeamId];
  const away = b.teamsById[f.awayTeamId];
  const { result, check } = resultOf(b, f);
  const played = Boolean(check?.ok);
  const homeWon = played && check.winner === 'home';

  const when = f.scheduledAt ? `${fmtDay(f.scheduledAt)} · ${f.timeTbd ? 'Time TBD' : fmtTime(f.scheduledAt)}` : 'Date TBD';
  const sub = [esc(b.event.title), f.label ? esc(f.label) : '', `Best of ${formatFor(b.season, f).bestOf}`].filter(Boolean).join(' · ');

  let body = '';
  if (played && result.forfeit) {
    body = notice('Forfeit', ` ${b.teamsById[result.forfeit.teamId]?.name ?? 'A team'} didn’t play, so it counts as a ${check.homeSets}–${check.awaySets} win.`);
  } else if (played) {
    const vod = safeUrl(result.vodUrl);
    // Admin-entered screenshot links, plus screenshots players attached to their votes.
    const voteShots = (b.submissions ?? []).filter((v) => v.fixtureId === f.id).flatMap((v) => v.screenshotPaths ?? []).map(mediaUrl);
    const shots = [...(result.screenshots ?? []).map(safeUrl), ...voteShots].filter(Boolean);
    const statsWaiting = result.statsStatus === 'pending' && !Object.keys(result.playerStats ?? {}).length;
    body = `
      ${statsWaiting ? notice('Stats coming soon', ' The score is in. An admin is checking the end-of-match screenshot for everyone’s stats.') : ''}
      ${boxScore(b, f.homeTeamId, result)}
      ${boxScore(b, f.awayTeamId, result)}
      ${vod || shots.length ? `<section class="panel">
        ${vod ? `<a class="btn btn-primary" href="${esc(vod)}" target="_blank" rel="noopener">▶ Watch the VOD</a>` : ''}
        ${shots.length ? `<div class="shots">${shots.map((s, i) => `<a href="${esc(s)}" target="_blank" rel="noopener"><img src="${esc(s)}" alt="Screenshot ${i + 1}" loading="lazy"></a>`).join('')}</div>` : ''}
      </section>` : ''}`;
  } else if (result) {
    body = notice('Result under review', ' An admin is checking this score.');
  } else {
    // Not played yet (or not reported): players vote on the result here.
    body = `${votesSummary(b, f)}${await reportBlock(b, f)}`;
  }
  const confirmed = played && result.source === 'votes'
    ? `<p class="muted small" style="margin-top:8px">✓ Confirmed by both teams’ votes${result.confirmedBy?.length ? `: ${result.confirmedBy.map((id) => {
      const v = (b.submissions ?? []).find((s) => s.id === id);
      return v ? esc(b.playersById[v.playerId]?.displayName ?? v.playerId) : '';
    }).filter(Boolean).join(' and ')}` : ''}</p>` : '';

  const mvp = played && result.mvpPlayerId
    ? `<div><span class="mvp-line">MVP · ${playerLink(b.playersById[result.mvpPlayerId], result.mvpPlayerId)}</span></div>` : '';

  return {
    title: `${home?.shortName ?? 'TBC'} v ${away?.shortName ?? 'TBC'}`,
    html: `
      <div class="stack">
        <section class="panel match-head">
          <p class="muted small">${sub}</p>
          <div class="mh-teams">
            <a class="mh-team ${played && !homeWon ? 'lost' : ''}" ${home ? `href="${urls.team(home.id)}" data-link` : ''}>${teamDot(home, 'xl')}${esc(home?.name ?? 'TBC')}</a>
            <div class="mh-score num">${played ? `${check.homeSets}<i>–</i>${check.awaySets}` : '<i>v</i>'}</div>
            <a class="mh-team ${played && homeWon ? 'lost' : ''}" ${away ? `href="${urls.team(away.id)}" data-link` : ''}>${teamDot(away, 'xl')}${esc(away?.name ?? 'TBC')}</a>
          </div>
          <p class="${f.scheduledAt ? '' : 'event-when tbd'}" style="font-weight:700">${esc(when)}</p>
          ${played && !result.forfeit ? `<div class="set-strip">${result.sets.map((s, i) => `<span>Set ${i + 1}: ${s.home}–${s.away}</span>`).join('')}<span>Points ${check.homePoints}–${check.awayPoints}</span></div>` : ''}
          ${mvp}
          ${confirmed}
        </section>
        ${body}
      </div>`,
  };
}

export function mount(el) {
  mountReport(el);
}
