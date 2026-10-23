// Teams & players: every approved team (logo, tagline, squad size, record) and every player
// (picture, club, level, matches). ?view=teams|players|free  (free = players without a club)

import { loadAllBundles, loadPeople, isApprovedTeam, loadMe } from '../data.js';
import { currentUser } from '../auth.js';
import { requestToJoin, withdrawJoinRequest } from '../player-data.js';
import { refresh } from '../nav.js';
import { esc, skeleton, notice, pageTitle, urls, avatarImg, teamDot, fmtNum, managerTag, framedImg, frameStyle } from '../ui.js';
import { mediaUrl } from '../media.js';
import { seasonMatches } from '../rules/season.js';
import { teamCareer, teamXp, playerXp, levelFor } from '../rules/badges.js';
import { careerStats } from './career.js';

export const title = 'Teams & players';

let joinCtx = null; // { user, player, requests, teamsById } for players who can ask to join a club

export function mount(el) {
  if (!joinCtx) return;
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act="request-join"], [data-act="withdraw-join"]');
    if (!b) return;
    const team = joinCtx.teamsById[b.dataset.id];
    const existing = joinCtx.requests.find((r) => r.teamId === team.id) ?? null;
    b.disabled = true;
    try {
      if (b.dataset.act === 'request-join') {
        await requestToJoin({ uid: joinCtx.user.uid, player: joinCtx.player, team, message: '', existing });
      } else {
        await withdrawJoinRequest({ uid: joinCtx.user.uid, request: existing });
      }
      refresh();
    } catch (err) {
      console.error(err);
      b.disabled = false;
      window.alert('That didn’t go through. Refresh and try again.');
    }
  });
}

export function loading() {
  return skeleton([80, 44, 260]);
}

// The "Request to join" button under a club card, for signed-in players without a club.
function joinButton(t) {
  if (!joinCtx) return '';
  if (!t.managerUid) return '<div class="tc-join"><span class="muted small">No manager to accept requests yet</span></div>';
  const req = joinCtx.requests.find((r) => r.teamId === t.id && r.status === 'pending');
  return req
    ? `<div class="tc-join"><span class="small">✓ Request sent</span><button class="btn btn-sm" type="button" data-act="withdraw-join" data-id="${esc(t.id)}">Withdraw</button></div>`
    : `<div class="tc-join"><button class="btn btn-sm btn-primary" type="button" data-act="request-join" data-id="${esc(t.id)}">Request to join</button></div>`;
}

function teamCards(teams, people, records) {
  if (!teams.length) return notice('No teams yet', ' Teams appear here once an admin approves them.', '55');
  return `<div class="team-grid">${teams.map((t) => {
    const r = records.get(t.id);
    const squad = people.players.filter((p) => p.teamId === t.id).length;
    const logo = mediaUrl(t.logoPath);
    const banner = mediaUrl(t.bannerPath);
    const boss = t.managerPlayerId ? people.playersById[t.managerPlayerId] : null;
    return `
      <div class="team-card-wrap">
      <a class="panel team-card" href="${urls.team(t.id)}" data-link style="--theme:${esc(t.theme ?? t.colors?.primary ?? '#1438d8')}">
        <div class="tc-banner">${banner ? `<img src="${esc(banner)}" alt="" loading="lazy" decoding="async" style="${frameStyle(t.bannerFrame)}">` : ''}</div>
        <div class="tc-body">
          ${logo ? framedImg({ src: logo, cls: 'tc-logo', frame: t.logoFrame })
            : `<span class="tc-logo mono" style="background:${esc(t.colors?.primary ?? '#ffffff')}">${esc((t.shortName ?? t.name).slice(0, 4))}</span>`}
          <div class="tc-text">
            <h3>${esc(t.name)}</h3>
            ${t.tagline ? `<p class="tc-tag">${esc(t.tagline)}</p>` : ''}
            <p class="muted small">${squad} player${squad === 1 ? '' : 's'}${r ? ` · ${r.wins}–${r.losses} · level ${levelFor(teamXp(r)).level}` : ''}</p>
            <p class="small tc-mgr">${boss ? `${managerTag()} ${esc(boss.displayName)}` : '<span class="muted">No manager yet</span>'}</p>
          </div>
        </div>
      </a>
      ${joinButton(t)}
      </div>`;
  }).join('')}</div>`;
}

function playerList(players, people, careers, emptyText) {
  if (!players.length) return notice(emptyText, '', 'x');
  return `<div class="panel flush"><ul class="people-list">${players.map((p) => {
    const team = p.teamId && isApprovedTeam(people.teamsById[p.teamId]) ? people.teamsById[p.teamId] : null;
    const c = careers.get(p.id);
    const lvl = levelFor(playerXp(c ?? null)).level;
    return `
      <li><a href="${urls.player(p.id)}" data-link>
        ${avatarImg(p, 'avatar')}
        <span class="pl-main">
          <b>${esc(p.displayName)}${p.number != null ? ` <span class="muted num">#${esc(p.number)}</span>` : ''}</b>
          <small>${team ? `<span class="team">${teamDot(team)}${esc(team.name)}</span>${team.managerPlayerId === p.id ? ` ${managerTag()}` : ''}` : '<span class="fa-tag">Free agent</span>'}${p.tagline ? ` · ${esc(p.tagline)}` : ''}</small>
        </span>
        <span class="pl-side"><b class="num">lv ${lvl}</b><small>${fmtNum(c?.matches ?? 0)} match${c?.matches === 1 ? '' : 'es'}</small></span>
      </a></li>`;
  }).join('')}</ul></div>`;
}

export async function render() {
  const params = new URLSearchParams(location.search);
  const view = ['players', 'free'].includes(params.get('view')) ? params.get('view') : 'teams';
  const [bundles, people] = await Promise.all([loadAllBundles(), loadPeople()]);
  const teams = people.teams.filter(isApprovedTeam).sort((a, b) => a.name.localeCompare(b.name));
  const players = people.players
    .filter((p) => p.active !== false)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const free = players.filter((p) => !p.teamId || !isApprovedTeam(people.teamsById[p.teamId]));

  const chip = (v, label, count) => `<a class="chip-link" href="/teams${v === 'teams' ? '' : `?view=${v}`}" data-link data-keep-scroll${v === view ? ' aria-current="true"' : ''}>${label} <span class="muted">&nbsp;${count}</span></a>`;
  const head = `
    <div class="page-head">${pageTitle('Teams &amp; players', 'Every club and player in JVO. Tap one for their profile.', 'knight')}</div>
    <nav class="chips">${chip('teams', 'Teams', teams.length)}${chip('players', 'Players', players.length)}${chip('free', 'Free agents', free.length)}</nav>`;

  // Signed-in players without a club can ask to join straight from the list.
  joinCtx = null;
  const user = await currentUser().catch(() => null);
  const mine = user ? people.players.find((p) => p.uid === user.uid) : null;
  if (mine && !(mine.teamId && isApprovedTeam(people.teamsById[mine.teamId]))) {
    const me = await loadMe(user.uid).catch(() => null);
    joinCtx = { user, player: mine, requests: me?.myJoinRequests ?? [], teamsById: people.teamsById };
  }

  let body;
  if (view === 'teams') {
    const records = teamCareer(bundles.map((b) => ({ eventId: b.event.id, matches: seasonMatches(b).matches })));
    body = teamCards(teams, people, records);
  } else {
    const careers = careerStats(bundles);
    body = view === 'free'
      ? `<p class="muted small" style="margin:0 0 10px">Players without a club. Managers can invite them from the Club hub.</p>${playerList(free, people, careers, 'No free agents right now')}`
      : playerList(players, people, careers, 'No players yet');
  }
  return { title: 'Teams & players', html: head + body };
}
