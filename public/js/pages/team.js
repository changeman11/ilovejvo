// Team profile (Steam style): banner, logo, level, badges, showcase stats, squad,
// record, upcoming fixtures and recent results. Everything is worked out from results.

import { loadAllBundles, loadPeople, NotFoundError, isApprovedTeam, loadJoinRequest } from '../data.js';
import { currentUser } from '../auth.js';
import { requestToJoin, withdrawJoinRequest } from '../player-data.js';
import { refresh } from '../nav.js';

let joinCtx = null; // { user, me, team, req } when the visitor can ask to join
import { esc, skeleton, avatarImg, urls, managerTag } from '../ui.js';
import { mediaUrl } from '../media.js';
import { seasonMatches } from '../rules/season.js';
import { seasonTeamStats } from '../rules/stats.js';
import { teamCareer, teamBadges, teamXp, levelFor } from '../rules/badges.js';
import { allFixtures, resultOf, fixtureRow } from './parts.js';
import { statDefsFor } from './career.js';
import { profileShell, showcaseTiles, badgesBlock, aboutBlock, sideBlock } from './profile-parts.js';
import { commentsBlock, mountComments } from './comments.js';

export const title = 'Team';

export function loading() {
  return skeleton([260, 120, 300]);
}

export async function render({ teamId }) {
  const [bundles, people] = await Promise.all([loadAllBundles(), loadPeople()]);
  const team = people.teamsById[teamId];
  if (!isApprovedTeam(team)) throw new NotFoundError('That team doesn’t exist');

  // Signed-in free agents can ask to join (the manager accepts in their Club hub).
  joinCtx = null;
  let joinBlock = '';
  const user = await currentUser().catch(() => null);
  const me = user ? people.players.find((p) => p.uid === user.uid) : null;
  if (me && !me.teamId) {
    const req = await loadJoinRequest(teamId, me.id);
    joinCtx = { user, me, team, req };
    joinBlock = req?.status === 'pending'
      ? `<div class="join-box"><span>✓ You’ve asked to join. The manager will see it in their Club hub.</span> <button class="btn btn-sm" data-act="withdraw-join">Withdraw</button></div>`
      : `<form class="join-box" data-form="join"><input type="text" name="message" maxlength="300" placeholder="Say hi to the manager (optional)"><button class="btn btn-primary" type="submit">Request to join</button>${req?.status === 'declined' ? '<span class="muted small">Your last request was declined.</span>' : ''}</form>`;
  }

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
  const boss = team.managerPlayerId ? people.playersById[team.managerPlayerId] : null;
  const sub = `${esc(team.shortName ?? '')}${squad.length ? ` · ${squad.length} player${squad.length === 1 ? '' : 's'}` : ''}${boss ? ` · ${managerTag()} <a href="${urls.player(boss.id)}" data-link>${esc(boss.displayName)}</a>` : ''}`;

  const main = `
    ${joinBlock ? `<section class="panel">${joinBlock}<p class="form-error" role="alert" hidden></p></section>` : ''}
    ${showcaseTiles('team', team.showcase, defs, { ...rec, totals, level: lvl.level })}
    ${aboutBlock(team.bio)}
    <section>
      <div class="section-head"><h2>Recent results</h2></div>
      <div class="panel flush fixtures">${recent.map(({ b, f }) => fixtureRow(b, f, { showEvent: true })).join('') || '<p class="muted" style="padding:16px">No results yet.</p>'}</div>
    </section>
    <section>
      <div class="section-head"><h2>Upcoming</h2></div>
      <div class="panel flush fixtures">${upcoming.map(({ b, f }) => fixtureRow(b, f, { showEvent: true })).join('') || '<p class="muted" style="padding:16px">Nothing scheduled.</p>'}</div>
    </section>
    ${await commentsBlock({ kind: 'team', targetId: teamId, ownerUid: team.managerUid ?? null })}`;

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
        ${p.id === team.managerPlayerId ? managerTag() : ''}${p.number != null ? `<span class="muted small">#${esc(p.number)}</span>` : ''}</li>`).join('')}</ul>`
      : '<p class="muted small">No players signed yet.</p>')}`;

  return {
    title: team.name,
    html: profileShell({ doc: team, fallbackTheme: team.colors?.primary, mark: logo, name: team.name, sub, lvl, main, side }),
  };
}

export function mount(el) {
  mountComments(el);
  if (!joinCtx) return;
  const { user, me, team, req } = joinCtx;
  const box = el.querySelector('.join-box');
  const fail = (err) => {
    console.error(err);
    const e = box?.parentElement.querySelector('.form-error');
    if (e) { e.textContent = 'That couldn’t be sent. Refresh and try again.'; e.hidden = false; }
  };
  el.querySelector('form[data-form="join"]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    e.target.querySelector('[type=submit]').disabled = true;
    try {
      await requestToJoin({ uid: user.uid, player: me, team, message: e.target.message.value.trim(), existing: req });
      refresh();
    } catch (err) { fail(err); }
  });
  el.querySelector('[data-act="withdraw-join"]')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await withdrawJoinRequest({ uid: user.uid, request: req });
      refresh();
    } catch (err) { fail(err); }
  });
}
