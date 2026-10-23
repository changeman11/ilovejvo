// App shell: picks the page for the current URL and draws it.
// Links with data-link switch pages without a full reload.
// <select data-nav> dropdowns navigate to the URL in their value.

import * as events from './pages/events.js';
import * as fixtures from './pages/fixtures.js';
import * as stats from './pages/stats.js';
import * as match from './pages/match.js';
import * as player from './pages/player.js';
import * as team from './pages/team.js';
import * as me from './pages/me.js';
import * as club from './pages/club.js';
import * as authCallback from './pages/auth-callback.js';
import * as requests from './pages/admin/requests.js';
import * as adminHome from './pages/admin/home.js';
import * as eventEdit from './pages/admin/event-edit.js';
import * as people from './pages/admin/people.js';
import * as resultEntry from './pages/admin/result.js';
import { NotFoundError } from './data.js';
import { onAdminChange, onUserChange, currentAdmin, startDiscordSignIn } from './auth.js';
import { renderShell, setSection } from './shell.js';
import './search.js';
import { updateBell } from './notifications.js';
import { updateReel } from './reel.js';
import { updateFeatured } from './featured.js';
import { syncSchedules } from './admin-sync.js';
import { stopLive } from './live.js';
import { startChatPanel } from './chat-panel.js';
import './characters.js'; // switches the court picture when characters are on
import * as teamsList from './pages/teams.js';
import * as help from './pages/help.js';
import * as helpEdit from './pages/admin/help-edit.js';
import { setNav } from './nav.js';
import { notice, esc, urls } from './ui.js';

// Path patterns. ":name" parts are passed to the page's render() as params.
// `section` is the menu item to highlight.
// `up` is where "back" goes when there's no previous page on this site (e.g. someone opened a shared link).
const toMenu = () => ({ href: '/', label: 'main menu' });
const toAdmin = () => ({ href: '/admin', label: 'admin' });
const routes = [
  { path: '/', page: events.home, section: '/' },
  { path: '/fixtures', page: fixtures, section: '/fixtures', up: toMenu, tabbed: true },
  { path: '/stats', page: stats, section: '/stats', up: toMenu, tabbed: true },
  { path: '/events', page: events.eventsList, section: '/events', up: toMenu, tabbed: true },
  { path: '/event/:eventId', page: events.eventPage, section: '/events', up: () => ({ href: '/events', label: 'events' }) },
  { path: '/match/:eventId/:fixtureId', page: match, section: '/fixtures', up: (p) => ({ href: urls.event(p.eventId), label: 'the event' }) },
  { path: '/player/:playerId', page: player, section: '/stats', up: () => ({ href: '/stats', label: 'stats' }) },
  { path: '/teams', page: teamsList, section: '/teams', up: toMenu, tabbed: true },
  { path: '/team/:teamId', page: team, section: '/teams', up: () => ({ href: '/teams', label: 'teams' }) },
  { path: '/help', page: help, section: '/help', up: toMenu, tabbed: true },
  { path: '/me', page: me, section: '/me', up: toMenu },
  { path: '/club', page: club, section: '/club', up: toMenu, tabbed: true },
  { path: '/auth/discord', page: authCallback, section: '/me' },
  { path: '/admin', page: adminHome, section: '/admin', up: toMenu },
  { path: '/admin/requests', page: requests, section: '/admin', up: toAdmin },
  { path: '/admin/people', page: people, section: '/admin', up: toAdmin },
  { path: '/admin/help', page: helpEdit, section: '/admin', up: toAdmin, tabbed: true },
  { path: '/admin/event/:eventId', page: eventEdit, section: '/admin', up: toAdmin, tabbed: true },
  { path: '/admin/result/:eventId/:fixtureId', page: resultEntry, section: '/admin', up: (p) => ({ href: urls.adminEvent(p.eventId, 'fixtures'), label: 'the event’s fixtures' }) },
];

// ---------- Back button (and Esc), like backing out of a menu in the game ----------
// history.state.trail is the list of pages that led here ([{ href, title }], oldest first), like a stack
// of menus. It never loops:
// - "back" goes to the last page on the trail and takes it off (or "up" when the trail is empty)
// - opening a page that's already on the trail cuts the trail back to it
// - opening a main-menu page (Fixtures, Stats, Club...) starts a fresh trail from the main menu
// - switching tabs or filters on the same page doesn't add a step
const shortTitle = () => (document.title === SITE_NAME ? 'main menu' : document.title.replace(` · ${SITE_NAME}`, ''));
const here = () => location.pathname + location.search;
const trailNow = () => history.state?.trail ?? [];
if (!history.state?.trail) history.replaceState({ trail: [] }, '');

const pathOf = (href) => new URL(href, location.origin).pathname.replace(/\/+$/, '') || '/';
const isMenuPage = (href) => matchRoute(pathOf(href)).up === toMenu;

// The trail for a page we're about to open from the current one.
function trailFor(href) {
  const trail = trailNow();
  const at = trail.findIndex((t) => t.href === href);
  if (at >= 0) return trail.slice(0, at); // already on the trail: back up to it
  if (pathOf(href) === '/') return [];
  if (pathOf(href) === pathOf(here())) return trail; // same page, other tab/filter
  if (isMenuPage(href)) return [{ href: '/', title: 'main menu' }];
  return [...trail, { href: here(), title: shortTitle() }].slice(-12);
}

function backTarget(route, params) {
  const last = trailNow().at(-1);
  if (last) return { href: last.href, label: last.title };
  return route.up?.(params) ?? null;
}

function backBar(route, params) {
  if (!route.up) return '';
  const target = backTarget(route, params);
  if (!target) return '';
  // Menus made of tabs get a "close" button (it closes the whole menu, never just a tab);
  // pages you drill into get "back to …".
  const button = route.tabbed
    ? `<a class="back-btn close" href="${esc(target.href)}" data-back title="Back to ${esc(target.label ?? 'the previous page')}"><span class="back-arrow" aria-hidden="true">✕</span><span>close</span></a>`
    : `<a class="back-btn" href="${esc(target.href)}" data-back><span class="back-arrow" aria-hidden="true">←</span><span>back${target.label ? ` to ${esc(target.label)}` : ''}</span></a>`;
  return `
    <nav class="backbar" aria-label="${route.tabbed ? 'Close' : 'Back'}">
      ${button}
      <span class="esc-hint" aria-hidden="true"><kbd>esc</kbd></span>
    </nav>`;
}

// Goes to the back target and takes it off the trail (replacing this page, so it can't loop back).
function goBack() {
  const route = matchRoute(pathOf(here()));
  const target = backTarget(route, route.params);
  if (!target) return;
  const trail = trailNow();
  const rest = trail.at(-1)?.href === target.href ? trail.slice(0, -1) : [];
  history.replaceState({ trail: rest }, '', target.href);
  window.scrollTo(0, 0);
  show();
}

document.addEventListener('click', (e) => {
  const link = e.target.closest('a[data-back]');
  if (!link || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  goBack();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]')) return;
  if (main.querySelector('a[data-back]')) goBack();
});

// Old addresses from earlier versions of the site.
const redirects = { '/exhibitions': '/events?type=exhibition', '/tournaments': '/events?type=tournament', '/manage': '/club' };

const notFound = {
  title: 'Not found',
  loading: () => '',
  render: async () => `${notice('Page not found', ' That link doesn’t go anywhere.', 'x')}<p style="text-align:center;margin-top:16px"><a class="btn" href="/" data-link>Home</a></p>`,
};

function matchRoute(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  for (const route of routes) {
    const pattern = route.path.split('/').filter(Boolean);
    if (pattern.length !== parts.length) continue;
    const params = {};
    const ok = pattern.every((p, i) => {
      if (p.startsWith(':')) {
        params[p.slice(1)] = decodeURIComponent(parts[i]);
        return true;
      }
      return p === parts[i];
    });
    if (ok) return { ...route, params };
  }
  return { page: notFound, params: {}, section: null };
}

const SITE_NAME = 'I<3JVO';
const main = document.getElementById('main');
let renderId = 0;

async function show({ quiet = false } = {}) {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  if (redirects[path]) {
    history.replaceState(history.state, '', redirects[path]);
    return show();
  }
  stopLive(); // the page being left stops watching for changes
  const route = matchRoute(path);
  const { page, params, section } = route;
  const id = ++renderId;

  setSection(section); // desktop side menu: highlight this page's card
  document.querySelectorAll('.topnav a, .tabbar a').forEach((a) => {
    if (a.getAttribute('href') === section) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  document.title = page === events.home ? SITE_NAME : `${page.title} · ${SITE_NAME}`;
  const back = backBar(route, params);
  if (!quiet) main.innerHTML = back + page.loading();
  try {
    const out = await page.render(params);
    if (id !== renderId) return; // the user already moved on
    const { html, title } = typeof out === 'string' ? { html: out } : out;
    main.innerHTML = back + html;
    if (title) document.title = `${title} · ${SITE_NAME}`;
    page.mount?.(main);
    renderShell(); // keeps the desktop bars (level, team, next match) up to date after saves
    updateBell({ force: ['/club', '/me'].includes(location.pathname) });
    updateReel();
    updateFeatured();
    syncSchedules().catch(() => 0); // admins only: saves schedules that just locked, finals that are ready
  } catch (err) {
    if (id !== renderId) return;
    if (err instanceof NotFoundError) {
      main.innerHTML = back + notice('Not found', ` ${err.message}.`, 'x');
    } else {
      console.error(err);
      main.innerHTML = back + notice('Couldn’t load this page', ' Check your connection and refresh.', 'x');
    }
  }
}

function navigate(href, { keepScroll = false, replace = false } = {}) {
  // A new version was published while this tab was open: load the next page fresh.
  if (updateWaiting && href !== here()) {
    location.assign(href);
    return;
  }
  if (href !== here()) {
    const samePage = pathOf(href) === pathOf(here());
    const trail = replace ? trailNow().filter((t) => t.href !== href) : trailFor(href);
    // Tabs and filters on the same page replace the entry, so browser back skips them too.
    if (replace || samePage) history.replaceState({ trail }, '', href);
    else history.pushState({ trail }, '', href);
    if (!keepScroll) window.scrollTo(0, 0);
  }
  show();
}

setNav({ navigate, refresh: () => show(), refreshQuietly: () => show({ quiet: true }) });

// "Sign in with Discord" buttons anywhere on the site. Comes back to the Me page.
document.addEventListener('click', (e) => {
  const button = e.target.closest('[data-discord-signin]');
  if (!button) return;
  try {
    startDiscordSignIn('/me');
  } catch (err) {
    const box = button.parentElement.querySelector('.form-error');
    if (box) { box.textContent = err.message; box.hidden = false; } else window.alert(err.message);
  }
});

document.addEventListener('click', (e) => {
  const link = e.target.closest('a[data-link]');
  if (!link || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  navigate(link.getAttribute('href'), { keepScroll: link.hasAttribute('data-keep-scroll') });
});

document.addEventListener('change', (e) => {
  const select = e.target.closest('select[data-nav]');
  if (select) navigate(select.value, { keepScroll: true });
});

window.addEventListener('popstate', show);

// The "Admin" menu link appears for admins: the admin login, or a Discord admin (see auth.js currentAdmin).
async function adminChanged() {
  let isAdmin = false;
  try {
    const a = await currentAdmin();
    // The Admin link stays for Discord admins with admin mode off, so they can switch it back on.
    isAdmin = Boolean(a.admin || a.modeOff);
  } catch { /* stay hidden */ }
  document.querySelectorAll('.admin-only').forEach((el) => { el.hidden = !isAdmin; });
  updateBell({ force: true }); // admin to-dos appear (or go) in the bell
}

// Desktop bars and the bell follow the player's sign-in (which can also make someone a Discord admin).
onUserChange(() => {
  renderShell();
  adminChanged();
  startChatPanel(); // the chat panel follows the sign-in (who you post as, your club)
});
onAdminChange(() => {
  adminChanged();
  startChatPanel();
});
// Admin mode switched on or off: redraw everything that shows admin tools.
document.addEventListener('jvo-admin-mode', () => {
  adminChanged();
  startChatPanel();
  show({ quiet: true });
});

show();

// Updates: the service worker is re-checked every 10 minutes (and when the tab comes back). When a
// new version of the site has been published, the next page change does a full load, so a tab left
// open never keeps running old code.
let updateWaiting = false;
if ('serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) updateWaiting = true; });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      const check = () => reg.update().catch(() => {});
      setInterval(check, 10 * 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    }).catch(() => {});
  });
}
