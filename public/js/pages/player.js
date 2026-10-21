// Player profile: career totals and averages, stats per event, and every match.

import { loadAllBundles, loadPeople, NotFoundError } from '../data.js';
import { esc, skeleton, notice, fmtNum, pct, teamDot, urls } from '../ui.js';
import { statHeads, statCells } from './parts.js';
import { careerStats, statDefsFor } from './career.js';

export const title = 'Player';

export function loading() {
  return skeleton([120, 90, 300]);
}

export async function render({ playerId }) {
  const [bundles, people] = await Promise.all([loadAllBundles(), loadPeople()]);
  const player = people.playersById[playerId];
  if (!player) throw new NotFoundError('That player doesn’t exist');

  const defs = statDefsFor(bundles);
  const career = careerStats(bundles).get(playerId);
  const initial = esc((player.displayName ?? '?').trim().charAt(0).toUpperCase());
  const lastTeam = career ? people.teamsById[career.log[career.log.length - 1]?.teamId] : null;

  const head = `
    <section class="panel profile">
      <div class="avatar">${initial}</div>
      <div>
        <h1>${esc(player.displayName)}</h1>
        <p class="muted">${lastTeam ? `<span class="team">${teamDot(lastTeam)}${esc(lastTeam.name)}</span>` : 'No matches yet'}${player.number ? ` · #${esc(player.number)}` : ''}</p>
      </div>
    </section>`;

  if (!career) return { title: player.displayName, html: `<div class="stack">${head}${notice('No matches yet', ' Stats appear after their first match.')}</div>` };

  const perMatch = Object.fromEntries(defs.map((d) => [d.key, career.matches ? (career.totals[d.key] ?? 0) / career.matches : 0]));
  const perSet = Object.fromEntries(defs.map((d) => [d.key, career.sets ? (career.totals[d.key] ?? 0) / career.sets : 0]));

  // Per event
  const byEvent = bundles
    .map((b) => {
      const one = careerStats([b]).get(playerId);
      return one ? { b, s: one } : null;
    })
    .filter(Boolean)
    .reverse();

  // Match log, newest first
  const fixtureOf = (eventId, fixtureId) => bundles.find((b) => b.event.id === eventId)?.fixtures.find((f) => f.id === fixtureId);
  const log = [...career.log].sort((a, b) => (fixtureOf(b.eventId, b.fixtureId)?.scheduledAt ?? 0) - (fixtureOf(a.eventId, a.fixtureId)?.scheduledAt ?? 0));
  const eventTitle = (id) => bundles.find((b) => b.event.id === id)?.event.title ?? '';

  return {
    title: player.displayName,
    html: `
      <div class="stack">
        ${head}
        <div class="tiles">
          <div class="tile"><b>${career.matches}</b><span>Matches</span></div>
          <div class="tile"><b>${pct(career.wins, career.matches)}</b><span>Won</span></div>
          <div class="tile"><b>${fmtNum(perMatch.pts ?? 0)}</b><span>Points per match</span></div>
          <div class="tile"><b>${career.mvps}</b><span>MVPs</span></div>
        </div>

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
        </section>
      </div>`,
  };
}
