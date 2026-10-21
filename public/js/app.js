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
import * as manage from './pages/manage.js';
import * as authCallback from './pages/auth-callback.js';
import * as requests from './pages/admin/requests.js';
import * as adminHome from './pages/admin/home.js';
import * as eventEdit from './pages/admin/event-edit.js';
import * as people from './pages/admin/people.js';
import * as resultEntry from './pages/admin/result.js';
import { NotFoundError } from './data.js';
import { onAdminChange, onUserChange, currentAdmin, startDiscordSignIn } from './auth.js';
import { renderShell } from './shell.js';
import * as teamsList from './pages/teams.js';
import { setNav } from './nav.js';
import { notice, esc, urls } from './ui.js';

// Path patterns. ":name" parts are passed to the page's render() as params.
// `section` is the menu item to highlight.
// `up` is where "back" goes when there's no previous page on this site (e.g. someone opened a shared link).
const toMenu = () => ({ href: '/', label: 'main menu' });
const toAdmin = () => ({ href: '/admin', label: 'admin' });
const routes = [
  { path: '/', page: events.home, section: '/' },
  { path: '/fixtures', page: fixtures, section: '/fixtures', up: toMenu },
  { path: '/stats', page: stats, section: '/stats', up: toMenu },
  { path: '/events', page: events.eventsList, section: '/events', up: toMenu },
  { path: '/event/:eventId', page: events.eventPage, section: '/events', up: () => ({ href: '/events', label: 'events' }) },
  { path: '/match/:eventId/:fixtureId', page: match, section: '/fixtures', up: (p) => ({ href: urls.event(p.eventId), label: 'the event' }) },
  { path: '/player/:playerId', page: player, section: '/stats', up: () => ({ href: '/stats', label: 'stats' }) },
  { path: '/teams', page: teamsList, section: '/teams', up: toMenu },
  { path: '/team/:teamId', page: team, section: '/teams', up: () => ({ href: '/teams', label: 'teams' }) },
  { path: '/me', page: me, section: '/me', up: toMenu },
  { path: '/manage', page: manage, section: '/me', up: () => ({ href: '/me', label: 'me' }) },
  { path: '/auth/discord', page: authCallback, section: '/me' },
  { path: '/admin', page: adminHome, section: '/admin', up: toMenu },
  { path: '/admin/requests', page: requests, section: '/admin', up: toAdmin },
  { path: '/admin/people', page: people, section: '/admin', up: toAdmin },
  { path: '/admin/event/:eventId', page: eventEdit, section: '/admin', up: toAdmin },
  { path: '/admin/result/:eventId/:fixtureId', page: resultEntry, section: '/admin', up: (p) => ({ href: urls.adminEvent(p.eventId, 'fixtures'), label: 'the event’s fixtures' }) },
];

// ---------- Back button (and Esc), like backing out of a menu in the game ----------
// Each page visit inside the site is numbered (history.state.depth) and remembers the page it came from,
// so "back" can say where it goes. With nothing to go back to, it goes "up" instead.
const shortTitle = () => (document.title === SITE_NAME ? 'main menu' : document.title.replace(` · ${SITE_NAME}`, ''));
if (!history.state) history.replaceState({ depth: 0 }, '');

function backBar(route, params) {
  const up = route.up?.(params);
  if (!up) return '';
  const fromHere = (history.state?.depth ?? 0) > 0;
  const label = fromHere ? history.state.from : up.label;
  return `
    <nav class="backbar" aria-label="Back">
      <a class="back-btn" href="${esc(up.href)}" data-back><span class="back-arrow" aria-hidden="true">←</span><span>back${label ? ` to ${esc(label)}` : ''}</span></a>
      <span class="esc-hint" aria-hidden="true"><kbd>esc</kbd></span>
    </nav>`;
}

function goBack(fallbackHref) {
  if ((history.state?.depth ?? 0) > 0) history.back();
  else navigate(fallbackHref, { replace: true });
}

document.addEventListener('click', (e) => {
  const link = e.target.closest('a[data-back]');
  if (!link || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  goBack(link.getAttribute('href'));
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]')) return;
  const link = main.querySelector('a[data-back]');
  if (link) goBack(link.getAttribute('href'));
});

// Old addresses from earlier versions of the site.
const redirects = { '/exhibitions': '/events?type=exhibition', '/tournaments': '/events?type=tournament' };

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

async function show() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  if (redirects[path]) {
    history.replaceState(history.state, '', redirects[path]);
    return show();
  }
  const route = matchRoute(path);
  const { page, params, section } = route;
  const id = ++renderId;

  document.querySelectorAll('.topnav a, .tabbar a').forEach((a) => {
    if (a.getAttribute('href') === section) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  document.title = page === events.home ? SITE_NAME : `${page.title} · ${SITE_NAME}`;
  const back = backBar(route, params);
  main.innerHTML = back + page.loading();
  try {
    const out = await page.render(params);
    if (id !== renderId) return; // the user already moved on
    const { html, title } = typeof out === 'string' ? { html: out } : out;
    main.innerHTML = back + html;
    if (title) document.title = `${title} · ${SITE_NAME}`;
    page.mount?.(main);
    renderShell(); // keeps the desktop bars (level, team, next match) up to date after saves
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
  if (href !== location.pathname + location.search) {
    const state = history.state ?? { depth: 0 };
    if (replace) history.replaceState(state, '', href);
    else history.pushState({ depth: (state.depth ?? 0) + 1, from: shortTitle() }, '', href);
    if (!keepScroll) window.scrollTo(0, 0);
  }
  show();
}

setNav({ navigate, refresh: show });

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

// Desktop bars follow the player's sign-in.
onUserChange(() => renderShell());

// The "Admin" menu link appears while the admin (password) sign-in is active.
onAdminChange(async () => {
  let isAdmin = false;
  try {
    isAdmin = Boolean((await currentAdmin()).admin);
  } catch { /* stay hidden */ }
  document.querySelectorAll('.admin-only').forEach((el) => { el.hidden = !isAdmin; });
});

show();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
