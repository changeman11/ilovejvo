// Player profile (Steam style): banner, picture, level, badges, showcase stats, team,
// upcoming fixtures, career totals, stats per event and every match.

import { loadAllBundles, loadPeople, NotFoundError, isApprovedTeam } from '../data.js';
import { esc, fmtNum, skeleton, avatarImg, teamLink, urls } from '../ui.js';
import { playerBadges, playerXp, levelFor } from '../rules/badges.js';
import { statHeads, statCells, allFixtures, resultOf, fixtureRow } from './parts.js';
import { careerStats, statDefsFor } from './career.js';
import { profileShell, showcaseTiles, badgesBlock, aboutBlock, sideBlock } from './profile-parts.js';
import { commentsBlock, mountComments } from './comments.js';

export const title = 'Player';

export function mount(el) {
  mountComments(el);
}

export function loading() {
  return skeleton([260, 90, 300]);
}

export async function render({ playerId }) {
  const [bundles, people] = await Promise.all([loadAllBundles(), loadPeople()]);
  const player = people.playersById[playerId];
  if (!player) throw new NotFoundError('That player doesn’t exist');

  const defs = statDefsFor(bundles);
  const career = careerStats(bundles).get(playerId) ?? null;
  const current = player.teamId ? people.teamsById[player.teamId] : null;
  const team = isApprovedTeam(current) ? current : null;
  const lvl = levelFor(playerXp(career));
  const sweeps = career?.log.filter((l) => l.won && l.setsAgainst === 0).length ?? 0;

  const sub = `${team ? teamLink(team) : 'Free agent'}${player.number != null ? ` · #${esc(player.number)}` : ''}`;
  const upcoming = team
    ? allFixtures(bundles).filter(({ b, f }) => (f.homeTeamId === team.id || f.awayTeamId === team.id) && !resultOf(b, f).result).slice(0, 4)
    : [];

  let stats = `<div class="notice"><strong>No matches yet</strong> Stats and badges appear after their first match.</div>`;
  if (career) {
    const perMatch = Object.fromEntries(defs.map((d) => [d.key, career.matches ? (career.totals[d.key] ?? 0) / career.matches : 0]));
    const perSet = Object.fromEntries(defs.map((d) => [d.key, career.sets ? (career.totals[d.key] ?? 0) / career.sets : 0]));
    const byEvent = bundles
      .map((b) => {
        const one = careerStats([b]).get(playerId);
        return one ? { b, s: one } : null;
      })
      .filter(Boolean)
      .reverse();
    const fixtureOf = (eventId, fixtureId) => bundles.find((b) => b.event.id === eventId)?.fixtures.find((f) => f.id === fixtureId);
    const log = [...career.log].sort((a, b) => (fixtureOf(b.eventId, b.fixtureId)?.scheduledAt ?? 0) - (fixtureOf(a.eventId, a.fixtureId)?.scheduledAt ?? 0));
    const eventTitle = (id) => bundles.find((b) => b.event.id === id)?.event.title ?? '';

    stats = `
      <section>
        <div class="section-head"><h2>Career</h2><span class="muted small">${career.sets} sets played</span></div>
        <div class="panel flush"><div class="table-wrap"><table class="data">
          <thead><tr><th class="first"></th>${statHeads(defs)}</tr></thead>
          <tbody>
            <tr><td class="first">Total</td>${statCells(career.totals, defs)}</tr>
            <tr><td class="first">Per match</td>${statCells(perMatch, defs, (n) => fmtNum(n, 1))}</tr>
            <tr><td class="first">Per set</td>${statCells(perSet, defs, (n) => fmtNum(n, 2))}</tr>
          </tbody>
        </table></div></div>
      </section>
      ${byEvent.length > 1 ? `
      <section>
        <div class="section-head"><h2>By event</h2></div>
        <div class="panel flush"><div class="table-wrap"><table class="data">
          <thead><tr><th class="first">Event</th><th title="Matches">M</th><th title="Matches won">W</th><th>MVP</th>${statHeads(defs)}</tr></thead>
          <tbody>${byEvent.map(({ b, s }) => `<tr><td class="first"><a class="plink" href="${urls.event(b.event.id)}" data-link>${esc(b.event.title)}</a></td><td>${s.matches}</td><td>${s.wins}</td><td>${s.mvps}</td>${statCells(s.totals, defs)}</tr>`).join('')}</tbody>
        </table></div></div>
      </section>` : ''}
      <section>
        <div class="section-head"><h2>Matches</h2></div>
        <div class="panel flush"><div class="table-wrap"><table class="data">
          <thead><tr><th class="first">Match</th><th>Result</th>${statHeads(defs)}</tr></thead>
          <tbody>${log.map((l) => {
            const opp = people.teamsById[l.opponentId];
            return `<tr>
              <td class="first"><a class="plink" href="${urls.match(l.eventId, l.fixtureId)}" data-link>v ${esc(opp?.shortName ?? opp?.name ?? l.opponentId)}</a> <span class="muted small">${esc(eventTitle(l.eventId))}</span>${l.mvp ? '<span class="badge">MVP</span>' : ''}</td>
              <td><span class="res ${l.won ? 'W' : 'L'}">${l.won ? 'W' : 'L'}</span> ${l.setsFor}–${l.setsAgainst}</td>
              ${statCells(l.line, defs)}
            </tr>`;
          }).join('')}</tbody>
        </table></div></div>
      </section>`;
  }

  const main = `
    ${career ? showcaseTiles('player', player.showcase, defs, { ...career, sweeps, level: lvl.level }) : ''}
    ${aboutBlock(player.bio)}
    ${stats}
    ${await commentsBlock({ kind: 'player', targetId: player.id, ownerUid: player.uid ?? null })}`;

  const side = `
    ${sideBlock('Badges', badgesBlock(playerBadges(career, defs), 'Badges are earned by playing matches.'))}
    ${team ? sideBlock('Team', `<p class="pro-team">${teamLink(team, { size: 'lg' })}</p>`) : ''}
    ${upcoming.length ? `<section><div class="section-head"><h2>Upcoming</h2></div>
      <div class="panel flush fixtures">${upcoming.map(({ b, f }) => fixtureRow(b, f, { showEvent: true })).join('')}</div></section>` : ''}`;

  return {
    title: player.displayName,
    html: profileShell({
      doc: player, fallbackTheme: team?.theme ?? team?.colors?.primary, mark: avatarImg(player, 'avatar pro-mark'),
      name: player.displayName, sub, lvl: career ? lvl : null, main, side,
    }),
  };
}
