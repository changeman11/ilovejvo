// Team profile (Steam style): banner, logo, level, badges, showcase stats, squad,
// record, upcoming fixtures and recent results. Everything is worked out from results.

import { loadAllBundles, loadPeople, NotFoundError, isApprovedTeam } from '../data.js';
import { esc, skeleton, avatarImg, urls } from '../ui.js';
import { mediaUrl } from '../media.js';
import { seasonMatches } from '../rules/season.js';
import { seasonTeamStats } from '../rules/stats.js';
import { teamCareer, teamBadges, teamXp, levelFor } from '../rules/badges.js';
import { allFixtures, resultOf, fixtureRow } from './parts.js';
import { statDefsFor } from './career.js';
import { profileShell, showcaseTiles, badgesBlock, aboutBlock, sideBlock } from './profile-parts.js';

export const title = 'Team';

export function loading() {
  return skeleton([260, 120, 300]);
}

export async function render({ teamId }) {
  const [bundles, people] = await Promise.all([loadAllBundles(), loadPeople()]);
  const team = people.teamsById[teamId];
  if (!isApprovedTeam(team)) throw new NotFoundError('That team doesn’t exist');

  const defs = statDefsFor(bundles);
  const keys = defs.map((d) => d.key);
  const empty = { matches: 0, wins: 0, losses: 0, setsWon: 0, setsLost: 0, pointsWon: 0, pointsLost: 0, events: 0, sweeps: 0, streak: 0, bestStreak: 0, unbeatenEvents: 0, form: [] };
  const eventMatches = bundles.map((b) => ({ eventId: b.event.id, b, matches: seasonMatches(b).matches }));
  const rec = teamCareer(eventMatches).get(teamId) ?? empty;

  // Team stat totals across every event (all players' stat lines added up).
  const totals = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const { b, matches } of eventMatches) {
    const t = seasonTeamStats({ matches, results: b.results, statKeys: keys }).get(teamId);
    if (t) for (const k of keys) totals[k] += t.totals[k];
  }
  const lvl = levelFor(teamXp(rec));

  const squad = people.players
    .filter((p) => p.teamId === teamId)
    .sort((a, b) => (b.id === team.managerPlayerId) - (a.id === team.managerPlayerId) || a.displayName.localeCompare(b.displayName));

  const mine = allFixtures(bundles).filter(({ f }) => f.homeTeamId === teamId || f.awayTeamId === teamId);
  const upcoming = mine.filter(({ b, f }) => !resultOf(b, f).result).slice(0, 5);
  const recent = mine.filter(({ b, f }) => resultOf(b, f).check?.ok).reverse().slice(0, 5);

  // Logo, or the short name on the team colour.
  const logoUrl = mediaUrl(team.logoPath);
  const logo = logoUrl
    ? `<img class="pro-mark team-logo" src="${esc(logoUrl)}" alt="${esc(team.name)} logo" decoding="async">`
    : `<span class="pro-mark team-logo mono" style="background:${esc(team.colors?.primary ?? '#ffffff')}">${esc((team.shortName ?? team.name).slice(0, 4))}</span>`;
  const sub = `${esc(team.shortName ?? '')}${squad.length ? ` · ${squad.length} player${squad.length === 1 ? '' : 's'}` : ''}`;

  const main = `
    ${showcaseTiles('team', team.showcase, defs, { ...rec, totals, level: lvl.level })}
    ${aboutBlock(team.bio)}
    <section>
      <div class="section-head"><h2>Recent results</h2></div>
      <div class="panel flush fixtures">${recent.map(({ b, f }) => fixtureRow(b, f, { showEvent: true })).join('') || '<p class="muted" style="padding:16px">No results yet.</p>'}</div>
    </section>
    <section>
      <div class="section-head"><h2>Upcoming</h2></div>
      <div class="panel flush fixtures">${upcoming.map(({ b, f }) => fixtureRow(b, f, { showEvent: true })).join('') || '<p class="muted" style="padding:16px">Nothing scheduled.</p>'}</div>
    </section>`;

  const side = `
    ${sideBlock('Badges', badgesBlock(teamBadges(rec), 'Badges are earned by playing matches.'))}
    ${sideBlock('Record', `
      <dl class="facts pro-facts">
        <div><dt>Won–lost</dt><dd>${rec.wins}–${rec.losses}</dd></div>
        <div><dt>Sets</dt><dd>${rec.setsWon}–${rec.setsLost}</dd></div>
        <div><dt>Points</dt><dd>${rec.pointsWon}–${rec.pointsLost}</dd></div>
        <div><dt>Events</dt><dd>${rec.events}</dd></div>
        <div><dt>Best streak</dt><dd>${rec.bestStreak}</dd></div>
      </dl>
      ${rec.form.length ? `<p class="small" style="margin-top:10px">Form ${rec.form.map((r) => `<span class="res ${r}">${r}</span>`).join(' ')}</p>` : ''}`)}
    ${sideBlock('Squad', squad.length ? `<ul class="squad">${squad.map((p) => `
      <li><a href="${urls.player(p.id)}" data-link>${avatarImg(p, 'avatar sm')}<span>${esc(p.displayName)}</span></a>
        ${p.id === team.managerPlayerId ? '<span class="badge">MGR</span>' : ''}${p.number != null ? `<span class="muted small">#${esc(p.number)}</span>` : ''}</li>`).join('')}</ul>`
      : '<p class="muted small">No players signed yet.</p>')}`;

  return {
    title: team.name,
    html: profileShell({ doc: team, fallbackTheme: team.colors?.primary, mark: logo, name: team.name, sub, lvl, main, side }),
  };
}
