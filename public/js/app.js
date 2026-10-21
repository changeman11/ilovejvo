// App shell: picks the page for the current URL and draws it.
// Links with data-link switch pages without a full reload.
// <select data-nav> dropdowns navigate to the URL in their value.

import * as events from './pages/events.js';
import * as leagueHome from './pages/league-home.js';
import * as table from './pages/table.js';
import * as fixtures from './pages/fixtures.js';
import * as match from './pages/match.js';
import * as teams from './pages/teams.js';
import * as team from './pages/team.js';
import * as player from './pages/player.js';
import * as stats from './pages/stats.js';
import * as playoffs from './pages/playoffs.js';
import * as authCallback from './pages/auth-callback.js';
import * as adminHome from './pages/admin/home.js';
import * as eventEdit from './pages/admin/event-edit.js';
import * as matchDay from './pages/admin/matchday.js';
import * as resultEntry from './pages/admin/result.js';
import { NotFoundError } from './data.js';
import { onUserChange, currentAdmin } from './auth.js';
import { setNav } from './nav.js';
import { notice } from './ui.js';

// Path patterns. ":name" parts are passed to the page's render() as params.
// `section` is the nav item to highlight.
// `league: true` pages are hidden from the public until the league launches
// (the database rules block the data too; see leagueIsPublic() in firestore.rules).
const routes = [
  { path: '/', page: events.home, section: '/' },
  { path: '/exhibitions', page: events.exhibitions, section: '/exhibitions' },
  { path: '/tournaments', page: events.tournaments, section: '/tournaments' },
  { path: '/event/:eventId', page: events.eventPage, section: null },

  { path: '/league', page: leagueHome, section: '/league', league: true },
  { path: '/table', page: table, section: '/league', league: true },
  { path: '/fixtures', page: fixtures, section: '/league', league: true },
  { path: '/match/:seasonId/:fixtureId', page: match, section: '/league', league: true },
  { path: '/teams', page: teams, section: '/league', league: true },
  { path: '/team/:teamId', page: team, section: '/league', league: true },
  { path: '/player/:playerId', page: player, section: '/league', league: true },
  { path: '/stats', page: stats, section: '/league', league: true },
  { path: '/playoffs', page: playoffs, section: '/league', league: true },

  { path: '/auth/discord', page: authCallback, section: '/admin' },
  { path: '/admin', page: adminHome, section: '/admin' },
  { path: '/admin/event/:eventId', page: eventEdit, section: '/admin' },
  { path: '/admin/matchday', page: matchDay, section: '/admin' },
  { path: '/admin/result/:seasonId/:fixtureId', page: resultEntry, section: '/admin' },
];

const notFound = {
  title: 'Not found',
  loading: () => '',
  render: async () => notice('Page not found', ' That link doesn’t go anywhere.'),
};

const comingSoon = {
  title: 'Coming soon',
  loading: () => '',
  render: async () => `${notice('Coming soon', ' The league isn’t open yet. For now, check out exhibition nights and upcoming tournaments.')}
    <p style="text-align:center;margin-top:16px"><a class="btn" href="/" data-link>Go to home</a></p>`,
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
  const route = matchRoute(path);
  const id = ++renderId;

  document.querySelectorAll('.topnav a, .tabbar a').forEach((a) => {
    if (a.getAttribute('href') === route.section) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  let { page } = route;
  if (route.league) {
    // League pages: admins only for now.
    const { admin } = await currentAdmin().catch(() => ({ admin: null }));
    if (id !== renderId) return;
    if (!admin) page = comingSoon;
  }

  document.title = page === events.home ? SITE_NAME : `${page.title} · ${SITE_NAME}`;
  main.innerHTML = page.loading();
  try {
    const out = await page.render(route.params);
    if (id !== renderId) return; // the user already moved on
    const { html, title } = typeof out === 'string' ? { html: out } : out;
    main.innerHTML = html;
    if (title) document.title = `${title} · ${SITE_NAME}`;
    page.mount?.(main); // optional per-page setup after drawing
  } catch (err) {
    if (id !== renderId) return;
    if (err instanceof NotFoundError) {
      main.innerHTML = notice('Not found', ` ${err.message}.`);
    } else {
      console.error(err);
      main.innerHTML = notice('Couldn’t load this page', ' Check your connection and refresh.');
    }
  }
}

function navigate(href, { keepScroll = false, replace = false } = {}) {
  if (href !== location.pathname + location.search) {
    if (replace) history.replaceState(null, '', href);
    else history.pushState(null, '', href);
    if (!keepScroll) window.scrollTo(0, 0);
  }
  show();
}

setNav({ navigate, refresh: show });

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

// Admin-only links in the header (League, Admin) appear for signed-in admins.
onUserChange(async () => {
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
