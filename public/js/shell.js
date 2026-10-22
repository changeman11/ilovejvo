// Desktop "game menu" frame, in the style of just volleyball's own menus:
// - top bar: a team box in the middle (like the game's party slots) and round icon buttons on the right
// - bottom bar: your picture, name, level and XP bar, team, next match and quick buttons
// Shown on wide screens only (CSS); phones keep the simple header and tab bar.

import { currentUser, discordOf, signOut } from './auth.js';
import { loadPeople, loadAllBundles, isApprovedTeam } from './data.js';
import { careerStats } from './pages/career.js';
import { playerXp, levelFor } from './rules/badges.js';
import { allFixtures, resultOf } from './pages/parts.js';
import { esc, avatarImg, teamDot, fmtDay, fmtTime, fmtNum, urls } from './ui.js';
import { discordLogo } from './pages/discord-cta.js';
import { discordInviteUrl, steamUrl } from './config.js';
import { navigate } from './nav.js';
import { menuCards } from './menu.js';

const desktop = matchMedia('(min-width: 1024px)');
const party = document.querySelector('[data-shell="party"]');
const icons = document.querySelector('[data-shell="icons"]');
const bar = document.querySelector('[data-shell="bar"]');
const side = document.querySelector('[data-shell="side"]');
const SLOTS = 5;

// ---------- Side menu: kept open on every page except Home ----------
let currentSection = null;
let menuState = 'guest'; // 'guest' | 'new' | 'player' (from the last sign-in check)

function drawSide() {
  const show = desktop.matches && currentSection !== '/';
  document.body.classList.toggle('has-side', show);
  side.hidden = !show;
  if (show) side.innerHTML = `<nav class="game-menu side">${menuCards(menuState, { active: currentSection ?? '' })}</nav>`;
}

// Called by app.js as soon as the address changes, so the right card lights up straight away.
export function setSection(section) {
  currentSection = section;
  drawSide();
}

const icon = {
  teams: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="8" r="3.2"/><circle cx="16" cy="8" r="3.2"/><path d="M2.5 19c0-3.2 2.5-5.5 5.5-5.5s5.5 2.3 5.5 5.5zM12 19c.2-2.4 1.3-4.3 3-5.1.3-.1.7-.2 1-.2 3 0 5.5 2.3 5.5 5.3z"/></svg>',
  cog: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.3 2h3.4l.5 2.6 1.6.7 2.2-1.5 2.4 2.4-1.5 2.2.7 1.6 2.4.5v3.4l-2.6.5-.7 1.6 1.5 2.2-2.4 2.4-2.2-1.5-1.6.7-.5 2.6h-3.4l-.5-2.6-1.6-.7-2.2 1.5-2.4-2.4 1.5-2.2-.7-1.6L2 13.7v-3.4l2.6-.5.7-1.6-1.5-2.2 2.4-2.4 2.2 1.5 1.6-.7zM12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z"/></svg>',
  power: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M7 6.3a7.5 7.5 0 1 0 10 0" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.2 3 4.5 6.7 4.5c2.1 0 3.6 1.2 4.3 2.4.7-1.2 2.2-2.4 4.3-2.4 3.7 0 5.8 3.7 4.3 7.2C19.5 16.4 12 21 12 21z"/></svg>',
  gem: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 21 9l-9 13L3 9z" fill="#3ddc84" stroke="#0b6b3a" stroke-width="1.5"/><path d="M3 9h18M12 2l-3 7 3 13 3-13z" fill="none" stroke="#0b6b3a" stroke-width="1"/></svg>',
};

let rendering = null;

// Works out everything the frame shows. Uses the same cached data as the pages.
async function gather() {
  const user = await currentUser().catch(() => null);
  const discord = user ? await discordOf(user).catch(() => null) : null;
  const [people, bundles] = await Promise.all([loadPeople(), loadAllBundles()]);
  const player = discord ? people.players.find((p) => p.uid === user.uid) ?? null : null;
  const maybeTeam = player?.teamId ? people.teamsById[player.teamId] : null;
  const team = isApprovedTeam(maybeTeam) ? maybeTeam : null;
  const career = player ? careerStats(bundles).get(player.id) ?? null : null;
  const lvl = levelFor(playerXp(career));
  const squad = team ? people.players.filter((p) => p.teamId === team.id) : [];
  const next = team
    ? allFixtures(bundles).find(({ b, f }) => (f.homeTeamId === team.id || f.awayTeamId === team.id) && !resultOf(b, f).result)
    : null;
  return { signedIn: Boolean(discord), player, team, career, lvl, squad, next, people };
}

function partyHtml({ signedIn, player, team, squad }) {
  const slot = (inner, href, label) => (href
    ? `<a class="slot" href="${href}" data-link title="${esc(label)}">${inner}</a>`
    : `<span class="slot" title="${esc(label)}">${inner}</span>`);
  const plus = '<span aria-hidden="true">+</span>';
  let lead;
  let slots = [];
  if (!signedIn) {
    lead = `<button class="party-lead" type="button" data-discord-signin>${discordLogo()}<span>make profile</span></button>`;
    slots = Array.from({ length: SLOTS }, () => slot(plus, '/me', 'Sign in to join a team'));
  } else if (!player) {
    lead = '<a class="party-lead" href="/me" data-link>finish profile</a>';
    slots = Array.from({ length: SLOTS }, () => slot(plus, '/me', 'Make your profile first'));
  } else if (!team) {
    lead = '<a class="party-lead" href="/me" data-link>find a team</a>';
    slots = [slot(avatarImg(player, 'slot-img'), urls.player(player.id), player.displayName),
      ...Array.from({ length: SLOTS - 1 }, () => slot(plus, '/me', 'Register a team or accept an offer'))];
  } else {
    const isManager = team.managerUid === player.uid;
    lead = `<a class="party-lead" href="${urls.team(team.id)}" data-link>${teamDot(team)}<span>${esc((team.shortName ?? team.name).toLowerCase())}</span></a>`;
    const shown = [...squad].sort((a, b) => (b.id === player.id) - (a.id === player.id)).slice(0, SLOTS);
    slots = [
      ...shown.map((p) => slot(avatarImg(p, 'slot-img'), urls.player(p.id), p.displayName)),
      ...Array.from({ length: SLOTS - shown.length }, () => slot(plus, isManager ? '/manage' : null, isManager ? 'Sign a player' : 'Open spot')),
    ];
  }
  return `${lead}<div class="slots">${slots.join('')}</div>`;
}

function iconsHtml({ signedIn }) {
  return `
    <a class="round-btn" href="/teams" data-link title="Teams" aria-label="Teams">${icon.teams}</a>
    <a class="round-btn" href="/admin" data-link title="Admin" aria-label="Admin">${icon.cog}</a>
    ${signedIn ? `<button class="round-btn danger" type="button" data-shell-signout title="Sign out" aria-label="Sign out">${icon.power}</button>` : ''}`;
}

function barHtml({ signedIn, player, team, career, lvl, next, people }) {
  const pct = player ? Math.round(((lvl.xp - lvl.from) / (lvl.next - lvl.from)) * 100) : 0;
  const who = player
    ? `<a class="pb-who" href="${urls.player(player.id)}" data-link>${avatarImg(player, 'pb-avatar')}</a>
       <div class="pb-id">
         <a class="pb-name" href="${urls.player(player.id)}" data-link>${esc(player.displayName)}</a>
         <div class="pb-xp"><span class="lv">lv ${lvl.level}</span><span class="xpbar"><i style="width:${pct}%"></i></span><span class="xpnum">${lvl.xp} / ${lvl.next} xp</span></div>
       </div>
       <span class="pb-gem" title="Points scored">${icon.gem}<b class="num">${fmtNum(career?.totals.pts ?? 0)}</b></span>`
    : `<span class="pb-who"><img class="pb-avatar" src="/images/art/face-x.jpg" alt=""></span>
       <div class="pb-id"><span class="pb-name">${signedIn ? 'new player' : 'guest'}</span>
         <div class="pb-xp"><span class="lv">lv 0</span><span class="xpbar"><i style="width:0"></i></span><span class="xpnum">${signedIn ? 'make your profile to start levelling' : 'sign in to start levelling'}</span></div></div>`;

  const buttons = `
    ${discordInviteUrl ? `<a class="pill-btn discord" href="${esc(discordInviteUrl)}" target="_blank" rel="noopener">${discordLogo()}<span>discord</span></a>` : ''}
    <a class="pill-btn wishlist" href="${esc(steamUrl)}" target="_blank" rel="noopener">${icon.heart}<span>wishlist</span></a>`;

  let opponent = null;
  if (next && team) {
    const oppId = next.f.homeTeamId === team.id ? next.f.awayTeamId : next.f.homeTeamId;
    opponent = people.teamsById[oppId];
  }
  const when = next ? (next.f.scheduledAt ? `${fmtDay(next.f.scheduledAt)}${next.f.timeTbd ? '' : ` ${fmtTime(next.f.scheduledAt)}`}` : 'date tbd') : '';
  const pills = `
    ${team ? `<a class="dark-pill" href="${urls.team(team.id)}" data-link>team: <b>${esc(team.name.toLowerCase())}</b></a>` : ''}
    ${next ? `<a class="dark-pill" href="${urls.match(next.b.event.id, next.f.id)}" data-link>next: <b>v ${esc((opponent?.name ?? 'tbc').toLowerCase())} · ${esc(when.toLowerCase())}</b></a>` : ''}
    <a class="cta-pill" href="/fixtures" data-link>fixtures</a>`;

  return `<div class="pb-left">${who}<span class="pb-sep" aria-hidden="true"></span>${buttons}</div><div class="pb-right">${pills}</div>`;
}

// Draws (or redraws) the frame. Cheap: all data comes from the page cache.
export function renderShell() {
  if (!desktop.matches || !bar) return Promise.resolve();
  rendering ??= gather()
    .then((s) => {
      menuState = s.signedIn ? (s.player ? 'player' : 'new') : 'guest';
      drawSide();
      party.innerHTML = partyHtml(s);
      icons.innerHTML = iconsHtml(s);
      bar.innerHTML = barHtml(s);
      party.hidden = false;
      bar.hidden = false;
    })
    .catch((err) => console.warn('Menu bar:', err))
    .finally(() => { rendering = null; });
  return rendering;
}

desktop.addEventListener('change', () => {
  drawSide();
  renderShell();
});

document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-shell-signout]')) return;
  if (!window.confirm('Sign out of Discord on this site?')) return;
  await signOut();
  navigate('/', { replace: true });
});
