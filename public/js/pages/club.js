// Club hub (/club): everything about your team in one place.
// - No team yet: locked. Shows invites to accept, your join requests, find a club, register a team.
// - In a team: the club overview (squad, upcoming matches, leaving).
// - Managers also get: Invite players, Join requests, Club page (logo, banner, bio...).
// Tabs: /club?tab=club | invite | requests | page. The security rules check every action again.

import { currentUser } from '../auth.js';
import { loadMe, isApprovedTeam, loadAllBundles } from '../data.js';
import {
  updateTeam, sendOffer, withdrawOffer, releasePlayer, answerOffer, registerTeam,
  requestLeave, cancelLeave, withdrawJoinRequest, answerJoinRequest,
} from '../player-data.js';
import { refresh, navigate } from '../nav.js';
import { esc, skeleton, notice, teamDot, teamLink, avatarImg, playerLink, urls, fmtDay, fmtTime } from '../ui.js';
import { prepareImage, FriendlyError, mediaUrl } from '../media.js';
import { DEFAULT_STATS } from '../rules/defaults.js';
import { customiseFields, saveCustomise, bindImagePreviews } from './customise.js';
import { makeProfileCard } from './discord-cta.js';
import { allFixtures, resultOf, fixtureRow } from './parts.js';
import { matchesToReport } from './report.js';
import { chatBlock, mountChat } from './team-chat.js';
import { signupsOpen, lockTime } from '../rules/autofix.js';
import { signUpTeam, withdrawTeam, handOverClub } from '../player-data.js';

export const title = 'Club hub';
export const loading = () => skeleton([160, 260]);

let page = null; // { user, me, team, isManager }

const LOCK = '<svg class="lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';

function tabsBar(active, tabs) {
  return `<nav class="club-tabs" aria-label="Club hub">${tabs.map(([id, label, count]) => `
    <a href="/club${id === 'club' ? '' : `?tab=${id}`}" data-link data-keep-scroll${active === id ? ' aria-current="page"' : ''}>${label}${count ? ` <span class="count">${count}</span>` : ''}</a>`).join('')}</nav>`;
}

// ---------- No team yet ----------

function lockedView(me) {
  const offers = me.offers.filter((o) => o.status === 'pending');
  const myReqs = (me.myJoinRequests ?? []).filter((r) => r.status === 'pending');
  const pending = me.pendingTeam;
  return `
    <section class="panel club-locked">
      <div class="club-lock-mark">${LOCK}</div>
      <div><h1>No club yet</h1><p class="muted">Accept an invite, ask to join a club, or start your own.</p></div>
    </section>
    <div class="cols">
      <div class="stack">
        <section>
          <div class="section-head"><h2>Invites</h2></div>
          <div class="panel flush rows">${offers.map((o) => {
            const t = me.teamsById[o.teamId];
            return `<div class="row">
              <span class="row-main"><b>${t ? teamLink(t) : esc(o.teamId)}</b><span class="muted small">wants you in their squad</span></span>
              <span class="row-side"><button class="btn btn-sm btn-primary" data-act="accept-offer" data-id="${esc(o.id)}">Accept</button>
                <button class="btn btn-sm" data-act="decline-offer" data-id="${esc(o.id)}">Decline</button></span>
            </div>`;
          }).join('') || '<p class="muted" style="padding:16px">No invites yet. Managers invite free agents from their Club hub.</p>'}</div>
        </section>
        <section>
          <div class="section-head"><h2>Your requests to join</h2><a href="/teams" data-link>Find a club</a></div>
          <div class="panel flush rows">${myReqs.map((r) => {
            const t = me.teamsById[r.teamId];
            return `<div class="row"><span class="row-main"><b>${t ? teamLink(t) : esc(r.teamId)}</b><span class="muted small">Waiting for their manager</span></span>
              <span class="row-side"><button class="btn btn-sm" data-act="withdraw-request" data-id="${esc(r.id)}">Withdraw</button></span></div>`;
          }).join('') || '<p class="muted" style="padding:16px">Open any team’s page and tap “Request to join”.</p>'}</div>
        </section>
      </div>
      <div class="stack">${pending ? pendingTeamBlock(pending) : registerBlock()}</div>
    </div>`;
}

function registerBlock() {
  return `
    <section>
      <div class="section-head"><h2>Start a club</h2></div>
      <form class="panel" data-form="register" novalidate>
        <p class="muted small" style="margin-bottom:10px">You’ll be the manager. An admin approves new clubs before they appear.</p>
        <div class="field-row">
          <label class="field"><span>Club name</span><input type="text" name="name" maxlength="60"></label>
          <label class="field"><span>Short name</span><input type="text" name="shortName" maxlength="5" placeholder="e.g. TAS"></label>
        </div>
        <label class="field"><span>Club colour (the dot next to its name)</span><input type="color" name="color" value="#19c9b1" class="color-input"></label>
        <details class="team-extras">
          <summary>Make your club page now (optional)</summary>
          ${customiseFields('team', {}, DEFAULT_STATS, '#19c9b1')}
        </details>
        <div class="save-bar"><button class="btn btn-primary" type="submit">Send for approval</button><p class="form-error" role="alert" hidden style="margin:0"></p></div>
      </form>
    </section>`;
}

function pendingTeamBlock(t) {
  return `
    <section>
      ${notice(`${t.name} is waiting for approval`, ' An admin will look at it soon. You become its manager once it’s approved. Meanwhile, set up its page.')}
    </section>
    <section>
      <div class="section-head"><h2>${esc(t.name)} club page</h2></div>
      <form class="panel" data-form="pending-team" novalidate>
        ${customiseFields('team', t, DEFAULT_STATS, t.colors?.primary)}
        <div class="save-bar"><button class="btn btn-primary" type="submit">Save club page</button><p class="form-error" role="alert" hidden style="margin:0"></p></div>
      </form>
    </section>`;
}

// ---------- In a team ----------

function clubHeader(team, squad, isManager) {
  const banner = mediaUrl(team.bannerPath);
  return `
    <section class="panel club-head" style="--theme:${esc(team.theme ?? team.colors?.primary ?? '#1438d8')}">
      <div class="club-banner">${banner ? `<img src="${esc(banner)}" alt="">` : ''}</div>
      <div class="club-id">
        ${teamDot(team, 'xl')}
        <div><h1>${esc(team.name)}</h1><p class="muted small">${esc(team.shortName ?? '')} · ${squad.length} player${squad.length === 1 ? '' : 's'}${isManager ? ' · you’re the manager' : ''}</p></div>
        <a class="btn btn-sm" href="${urls.team(team.id)}" data-link>Public page</a>
      </div>
    </section>`;
}

function overviewTab({ me, team, isManager, squad, toReport, upcoming }) {
  const pendingLeave = me.leaves.find((l) => l.status === 'pending' && l.teamId === team.id);
  return `
    <div class="cols">
      <div class="stack">
        <section>
          <div class="section-head"><h2>Squad</h2>${isManager ? '<a href="/club?tab=manager#mgr-invite" data-link>+ Invite players</a>' : ''}</div>
          <div class="panel flush rows">${squad.map((p) => `
            <div class="row">
              <span class="row-main squad-row">${avatarImg(p, 'avatar sm')}<b>${playerLink(p)}${p.id === team.managerPlayerId ? '<span class="badge">MGR</span>' : ''}</b>${p.number != null ? `<span class="muted small">#${esc(p.number)}</span>` : ''}</span>
              <span class="row-side"></span>
            </div>`).join('')}</div>
        </section>
        ${toReport.length ? `
        <section>
          <div class="section-head"><h2>Report results</h2><span class="muted small">Tap a match to vote</span></div>
          <div class="panel flush fixtures">${toReport.map(({ b, f }) => fixtureRow(b, f, { showEvent: true })).join('')}</div>
        </section>` : ''}
      </div>
      <div class="stack">
        ${chatBlock(team)}
        <section>
          <div class="section-head"><h2>Next matches</h2><a href="/fixtures?team=${encodeURIComponent(team.id)}" data-link>All</a></div>
          <div class="panel flush fixtures">${upcoming.map(({ b, f }) => fixtureRow(b, f, { showEvent: true })).join('') || '<p class="muted" style="padding:16px">Nothing scheduled.</p>'}</div>
        </section>
        ${isManager ? '' : `
        <section>
          <div class="section-head"><h2>Leaving the club</h2></div>
          ${pendingLeave
            ? `<div class="panel"><p><b>You’ve asked to leave.</b> An admin will decide soon.</p>
                <button class="btn btn-sm" data-act="cancel-leave" data-id="${esc(pendingLeave.id)}" style="margin-top:10px">Cancel request</button></div>`
            : `<form class="panel" data-form="leave" novalidate>
                <label class="field"><span>Reason (optional, admins see it)</span><textarea name="reason" rows="2" maxlength="500"></textarea></label>
                <button class="btn" type="submit">Ask to leave ${esc(team.name)}</button>
                <p class="form-error" role="alert" hidden></p>
              </form>`}
        </section>`}
      </div>
    </div>`;
}

// ---------- Manager section: everything a manager does, in one place ----------

function managerTab(ctx) {
  const { me, team, squad, toReport, events } = ctx;
  const requests = (me.teamJoinRequests ?? []).filter((r) => r.status === 'pending');
  const invitesOut = me.sentOffers.filter((o) => o.teamId === team.id && o.status === 'pending');
  const openEvents = events.filter((x) => x.open);
  const toSignUp = openEvents.filter((x) => !x.entered);
  const todo = [
    ['#mgr-requests', requests.length, 'join request', 'join requests'],
    ['#mgr-events', toSignUp.length, 'event to sign up for', 'events to sign up for'],
    ['#mgr-results', toReport.length, 'result to report', 'results to report'],
    ['#mgr-invite', invitesOut.length, 'invite waiting', 'invites waiting'],
  ];
  return `
    <div class="stack">
      <section class="panel mgr-todo">
        <h2 style="margin:0 0 8px">Manager to-do</h2>
        <div class="mgr-cards">${todo.map(([href, n, one, many]) => `
          <a class="mgr-card${n ? ' hot' : ''}" href="${href}"><b class="num">${n}</b><span>${n === 1 ? one : many}</span></a>`).join('')}
        </div>
      </section>

      <div class="cols">
        <div class="stack">
          <section id="mgr-requests">${requestsTab(ctx)}</section>

          <section id="mgr-events">
            <div class="section-head"><h2>Event sign-ups</h2><a href="/events" data-link>All events</a></div>
            <div class="panel flush rows">${events.map(({ b, open, entered, closes }) => `
              <div class="row">
                <span class="row-main"><b><a href="${urls.event(b.event.id)}" data-link>${esc(b.event.title)}</a></b>
                  <span class="muted small">${entered ? '✓ Signed up · ' : ''}${open ? (closes ? `Sign-ups close ${esc(fmtDay(closes))} ${esc(fmtTime(closes))}` : 'Sign-ups open') : 'Sign-ups closed'}</span></span>
                <span class="row-side">${open ? (entered
                  ? `<button class="btn btn-sm" data-act="event-out" data-id="${esc(b.event.id)}">Pull out</button>`
                  : `<button class="btn btn-sm btn-primary" data-act="event-in" data-id="${esc(b.event.id)}">Sign up</button>`) : ''}</span>
              </div>`).join('') || '<p class="muted" style="padding:16px">No events taking sign-ups right now. You’ll get a notification when one opens.</p>'}</div>
          </section>

          <section id="mgr-results">
            <div class="section-head"><h2>Results to report</h2></div>
            <div class="panel flush fixtures">${toReport.map(({ b, f }) => fixtureRow(b, f, { showEvent: true })).join('') || '<p class="muted" style="padding:16px">Nothing to report.</p>'}</div>
          </section>
        </div>

        <div class="stack">
          <section id="mgr-squad">
            <div class="section-head"><h2>Squad</h2><span class="muted small">${squad.length} player${squad.length === 1 ? '' : 's'}</span></div>
            <div class="panel flush rows">${squad.map((p) => {
              const isMe = p.uid === page.user.uid;
              return `<div class="row">
                <span class="row-main squad-row">${avatarImg(p, 'avatar sm')}<b>${playerLink(p)}${p.id === team.managerPlayerId ? '<span class="badge">MGR</span>' : ''}</b></span>
                <span class="row-side">${isMe ? '<span class="muted small">you</span>' : `
                  ${p.uid ? `<button class="btn btn-sm" data-act="hand-over" data-id="${esc(p.id)}">Make manager</button>` : ''}
                  <button class="btn btn-sm btn-danger" data-act="release" data-id="${esc(p.id)}">Release</button>`}</span>
              </div>`;
            }).join('')}</div>
            <p class="muted small">Making someone manager hands the club over to them; you stay in the squad.</p>
          </section>
          <section class="panel">
            <h3 style="margin-top:0">Club page</h3>
            <p class="small">Logo, banner, background, bio, colours and showcase stats.</p>
            <div class="event-links"><a class="btn btn-sm btn-primary" href="/club?tab=page" data-link>Edit club page</a><a class="btn btn-sm" href="${urls.team(team.id)}" data-link>View public page</a></div>
          </section>
        </div>
      </div>

      <div id="mgr-invite">${inviteTab(ctx)}</div>
    </div>`;
}

function inviteTab({ me, team }) {
  const sent = me.sentOffers.filter((o) => o.teamId === team.id);
  const pending = sent.filter((o) => o.status === 'pending');
  const offered = new Set(pending.map((o) => o.playerId));
  const freeAgents = me.players
    .filter((p) => p.uid && !p.teamId && p.active !== false && !offered.has(p.id))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const recent = sent.filter((o) => o.status !== 'pending').slice(-8).reverse();
  return `
    <div class="cols">
      <section>
        <div class="section-head"><h2>Invite free agents</h2><span class="muted small">${freeAgents.length} available</span></div>
        <div class="panel">
          <p class="muted small" style="margin-bottom:10px">They get a notification (the bell) and can accept from their Club hub.</p>
          <label class="field"><span>Search</span><input type="search" data-filter placeholder="Player name"></label>
          <div class="rows" data-agents>${freeAgents.map((p) => `
            <div class="row" data-name="${esc(p.displayName.toLowerCase())}">
              <span class="row-main squad-row">${avatarImg(p, 'avatar sm')}<b>${playerLink(p)}</b></span>
              <span class="row-side"><button class="btn btn-sm btn-primary" data-act="offer" data-id="${esc(p.id)}">Invite</button></span>
            </div>`).join('') || '<p class="muted">No free agents right now.</p>'}</div>
        </div>
      </section>
      <section>
        <div class="section-head"><h2>Invites sent</h2></div>
        <div class="panel flush rows">
          ${pending.map((o) => `<div class="row"><span class="row-main"><b>${esc(me.playersById[o.playerId]?.displayName ?? o.playerId)}</b><span class="muted small">Waiting for them</span></span>
            <span class="row-side"><button class="btn btn-sm" data-act="withdraw" data-id="${esc(o.id)}">Withdraw</button></span></div>`).join('')}
          ${recent.map((o) => `<div class="row"><span class="row-main"><b>${esc(me.playersById[o.playerId]?.displayName ?? o.playerId)}</b><span class="muted small">${esc(o.status)}</span></span></div>`).join('')}
          ${!sent.length ? '<p class="muted" style="padding:16px">No invites yet.</p>' : ''}
        </div>
      </section>
    </div>`;
}

function requestsTab({ me }) {
  const reqs = (me.teamJoinRequests ?? []).filter((r) => r.status === 'pending')
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return `
    <section>
      <div class="section-head"><h2>Players asking to join</h2></div>
      <div class="panel flush rows">${reqs.map((r) => {
        const p = me.playersById[r.playerId];
        return `<div class="row">
          <span class="row-main squad-row">${avatarImg(p, 'avatar sm')}<span><b>${playerLink(p, r.playerId)}</b>
            <span class="muted small" style="display:block">${r.createdAt ? esc(fmtDay(r.createdAt)) : ''}${r.message ? ` · “${esc(r.message)}”` : ''}</span></span></span>
          <span class="row-side"><button class="btn btn-sm btn-primary" data-act="accept-request" data-id="${esc(r.id)}">Accept</button>
            <button class="btn btn-sm" data-act="decline-request" data-id="${esc(r.id)}">Decline</button></span>
        </div>`;
      }).join('') || '<p class="muted" style="padding:16px">No requests right now. Free agents can ask to join from your club’s public page.</p>'}</div>
    </section>`;
}

function pageTab({ team }) {
  return `
    <section>
      <div class="section-head"><h2>Club page</h2><a href="${urls.team(team.id)}" data-link>View it</a></div>
      <form class="panel" data-form="team" novalidate>
        <div class="field-row">
          <label class="field"><span>Name</span><input type="text" name="name" maxlength="60" value="${esc(team.name)}"></label>
          <label class="field"><span>Short name</span><input type="text" name="shortName" maxlength="5" value="${esc(team.shortName ?? '')}"></label>
        </div>
        <label class="field"><span>Club colour (dot next to the name)</span><input type="color" name="color" value="${esc(team.colors?.primary ?? '#19c9b1')}" class="color-input"></label>
        ${customiseFields('team', team, DEFAULT_STATS, team.colors?.primary)}
        <div class="save-bar"><button class="btn btn-primary" type="submit">Save club page</button><p class="form-error" role="alert" hidden style="margin:0"></p></div>
      </form>
    </section>`;
}

export async function render() {
  page = null;
  const user = await currentUser();
  if (!user) {
    return { title: 'Club hub', html: `<div class="club-root stack"><section class="panel club-locked"><div class="club-lock-mark">${LOCK}</div><div><h1>Club hub</h1><p class="muted">Sign in to join a club, accept invites or run your own.</p></div></section>${makeProfileCard()}</div>` };
  }
  const me = await loadMe(user.uid);
  if (!me.player) {
    return { title: 'Club hub', html: `<div class="club-root">${notice('Make your profile first', ' Then you can join or start a club.', 'pink')}<p style="text-align:center;margin-top:12px"><a class="btn btn-primary" href="/me" data-link>Make my profile</a></p></div>` };
  }
  const team = isApprovedTeam(me.team) ? me.team : null;
  const isManager = Boolean(team && team.managerUid === user.uid);
  page = { user, me, team, isManager };
  if (!team) return { title: 'Club hub', html: `<div class="club-root stack">${lockedView(me)}</div>` };

  const squad = me.players.filter((p) => p.teamId === team.id)
    .sort((a, b) => (b.id === team.managerPlayerId) - (a.id === team.managerPlayerId) || a.displayName.localeCompare(b.displayName));
  const bundles = await loadAllBundles().catch(() => []);
  const upcoming = allFixtures(bundles).filter(({ b, f }) => (f.homeTeamId === team.id || f.awayTeamId === team.id) && !resultOf(b, f).result).slice(0, 5);
  const toReport = matchesToReport(bundles, me.player).filter((x) => !x.voted).slice(0, 4);
  const requests = (me.teamJoinRequests ?? []).filter((r) => r.status === 'pending').length;

  // Events this club can sign up for (or is in), soonest first.
  const now = Date.now();
  const events = bundles
    .filter((b) => b.event.status === 'upcoming' && b.event.signups)
    .map((b) => ({ b, open: signupsOpen(b.event, now), entered: b.plan.teamIds.includes(team.id), closes: lockTime(b.event), entry: b.entries.find((x) => x.teamId === team.id) ?? null }))
    .sort((x, y) => (x.b.event.date ?? Infinity) - (y.b.event.date ?? Infinity));
  const todoCount = requests + events.filter((x) => x.open && !x.entered).length + toReport.length;

  // Old tab names (invite, requests) open the Manager section.
  let want = new URLSearchParams(location.search).get('tab') ?? 'club';
  if (['invite', 'requests'].includes(want)) want = 'manager';
  const tab = isManager && ['manager', 'page'].includes(want) ? want : 'club';
  const tabs = isManager
    ? [['club', 'Club'], ['manager', 'Manager', todoCount], ['page', 'Club page']]
    : [['club', 'Club']];
  const ctx = { me, team, isManager, squad, toReport, upcoming, events };
  page.events = events;
  const body = { club: overviewTab, manager: managerTab, page: pageTab }[tab](ctx);
  return {
    title: `${team.name} · Club hub`,
    html: `<div class="club-root stack">${clubHeader(team, squad, isManager)}${tabs.length > 1 ? tabsBar(tab, tabs) : ''}${body}<p class="form-error" role="alert" hidden data-global></p></div>`,
  };
}

export function mount(el) {
  const root = el.querySelector('.club-root');
  if (!root || !page) return;
  bindImagePreviews(root);
  const { user, me, team } = page;
  if (team) mountChat(root, { user, player: me.player, team, isManager: page.isManager, playersById: me.playersById });
  // Links to a part of the Manager section (e.g. #mgr-invite) scroll to it.
  if (location.hash) root.querySelector(location.hash)?.scrollIntoView({ block: 'start' });
  const showError = (msg, near) => {
    const box = near?.closest('form, section')?.querySelector('.form-error') ?? root.querySelector('[data-global]');
    if (!box) return window.alert(msg);
    box.textContent = msg;
    box.hidden = false;
  };
  const fail = (err, near) => {
    console.error(err);
    if (err instanceof FriendlyError) return showError(err.message, near);
    showError(err.code === 'permission-denied' ? 'That isn’t allowed any more (it may have changed). Refresh and try again.' : 'Something went wrong. Check your connection and try again.', near);
  };

  root.addEventListener('input', (e) => {
    if (!e.target.matches('[data-filter]')) return;
    const q = e.target.value.trim().toLowerCase();
    root.querySelectorAll('[data-agents] .row').forEach((r) => { r.hidden = q && !r.dataset.name.includes(q); });
  });

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.dataset.id;
    const act = b.dataset.act;
    try {
      if (act === 'release') {
        const p = me.playersById[id];
        if (!window.confirm(`Release ${p.displayName}? They become a free agent straight away.`)) return;
      }
      if (act === 'hand-over') {
        const p = me.playersById[id];
        if (!window.confirm(`Make ${p.displayName} the manager of ${team.name}? You’ll stay in the squad but lose the manager tools.`)) return;
      }
      const ev = page.events?.find((x) => x.b.event.id === id);
      if (act === 'event-out' && !window.confirm(`Pull ${team.name} out of ${ev?.b.event.title}?`)) return;
      b.disabled = true;
      if (act === 'hand-over') await handOverClub({ uid: user.uid, team, player: me.playersById[id] });
      if (act === 'event-in') await signUpTeam({ uid: user.uid, eventId: id, team });
      if (act === 'event-out') await withdrawTeam({ uid: user.uid, eventId: id, entry: ev.entry });
      if (act === 'offer') await sendOffer({ uid: user.uid, team, player: me.playersById[id] });
      if (act === 'withdraw') await withdrawOffer({ uid: user.uid, offer: me.sentOffers.find((o) => o.id === id) });
      if (act === 'release') await releasePlayer({ uid: user.uid, player: me.playersById[id] });
      if (act === 'accept-offer' || act === 'decline-offer') {
        await answerOffer({ uid: user.uid, offer: me.offers.find((o) => o.id === id), player: me.player, accept: act === 'accept-offer' });
      }
      if (act === 'withdraw-request') await withdrawJoinRequest({ uid: user.uid, request: me.myJoinRequests.find((r) => r.id === id) });
      if (act === 'accept-request' || act === 'decline-request') {
        const request = me.teamJoinRequests.find((r) => r.id === id);
        await answerJoinRequest({ uid: user.uid, request, player: me.playersById[request.playerId], accept: act === 'accept-request' });
      }
      if (act === 'cancel-leave') await cancelLeave({ uid: user.uid, request: me.leaves.find((l) => l.id === id) });
      refresh();
    } catch (err) {
      b.disabled = false;
      fail(err, b);
    }
  });

  root.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const val = (n) => form.querySelector(`[name="${n}"]`)?.value.trim() ?? '';
    const button = form.querySelector('[type=submit]');
    const label = button?.textContent;
    try {
      if (form.dataset.form === 'register') {
        const name = val('name');
        if (!name) return showError('Give your club a name.', form);
        if (me.teams.some((t) => t.name.toLowerCase() === name.toLowerCase())) return showError('That name is taken.', form);
        for (const input of form.querySelectorAll('input[type=file][name^="file-"]')) {
          if (input.files?.[0]) await prepareImage(input.files[0], input.name.slice(5));
        }
        button.disabled = true;
        button.textContent = 'Sending…';
        const color = form.querySelector('[name=color]').value;
        const teamId = await registerTeam({
          uid: user.uid, player: me.player, name,
          shortName: (val('shortName') || name.replace(/[^A-Za-z0-9]/g, '').slice(0, 3)).toUpperCase(),
          color, takenIds: new Set(me.teams.map((t) => t.id)),
        });
        try {
          await saveCustomise({ form, kind: 'team', owner: 'teams', id: teamId, doc: { id: teamId }, save: (changes) => updateTeam({ uid: user.uid, team: { id: teamId }, changes }) });
        } catch (err) {
          console.error(err);
          window.alert('Your club was sent for approval, but its page details didn’t all save. You can finish them here.');
        }
      }
      if (form.dataset.form === 'pending-team') {
        button.disabled = true;
        button.textContent = 'Saving…';
        const t = me.pendingTeam;
        await saveCustomise({ form, kind: 'team', owner: 'teams', id: t.id, doc: t, save: (changes) => updateTeam({ uid: user.uid, team: t, changes }) });
      }
      if (form.dataset.form === 'team') {
        if (!val('name')) return showError('The club needs a name.', form);
        button.disabled = true;
        button.textContent = 'Saving…';
        await saveCustomise({
          form, kind: 'team', owner: 'teams', id: team.id, doc: team,
          extra: { name: val('name'), shortName: (val('shortName') || val('name').slice(0, 3)).toUpperCase(), colors: { ...(team.colors ?? {}), primary: val('color') } },
          save: (changes) => updateTeam({ uid: user.uid, team, changes }),
        });
      }
      if (form.dataset.form === 'leave') {
        button.disabled = true;
        await requestLeave({ uid: user.uid, player: me.player, reason: val('reason') });
      }
      refresh();
    } catch (err) {
      if (button) { button.disabled = false; button.textContent = label; }
      fail(err, form);
    }
  });
}

// Old address.
export const goToClub = () => navigate('/club', { replace: true });
