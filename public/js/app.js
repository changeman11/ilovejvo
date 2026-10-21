// App shell: picks the page for the current URL and draws it.
// Links with data-link switch pages without a full reload.
// <select data-nav> dropdowns navigate to the URL in their value.

import * as home from './pages/home.js';
import * as table from './pages/table.js';
import * as fixtures from './pages/fixtures.js';
import * as match from './pages/match.js';
import * as teams from './pages/teams.js';
import * as team from './pages/team.js';
import * as player from './pages/player.js';
import * as authCallback from './pages/auth-callback.js';
import * as matchDay from './pages/admin/matchday.js';
import * as resultEntry from './pages/admin/result.js';
import { NotFoundError } from './data.js';
import { onUserChange, currentAdmin } from './auth.js';
import { setNav } from './nav.js';
import { notice } from './ui.js';

const comingSoon = (name, phase) => ({
  title: name,
  loading: () => '',
  render: async () => `<section class="hero"><h1>${name}</h1></section>${notice('Coming soon', ` This page arrives in phase ${phase}.`)}`,
});

// Path patterns. ":name" parts are passed to the page's render() as params.
// `section` is the main nav item to highlight.
const routes = [
  { path: '/', page: home, section: '/' },
  { path: '/table', page: table, section: '/table' },
  { path: '/fixtures', page: fixtures, section: '/fixtures' },
  { path: '/match/:seasonId/:fixtureId', page: match, section: '/fixtures' },
  { path: '/teams', page: teams, section: '/teams' },
  { path: '/team/:teamId', page: team, section: '/teams' },
  { path: '/player/:playerId', page: player, section: '/teams' },
  { path: '/stats', page: comingSoon('Statistics', 4), section: '/stats' },
  { path: '/auth/discord', page: authCallback, section: '/admin' },
  { path: '/admin', page: matchDay, section: '/admin' },
  { path: '/admin/result/:seasonId/:fixtureId', page: resultEntry, section: '/admin' },
];

const notFound = {
  title: 'Not found',
  loading: () => '',
  render: async () => notice('Page not found', ' That link doesn’t go anywhere.'),
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
  const { page, params, section } = matchRoute(path);
  const id = ++renderId;

  document.querySelectorAll('.topnav a, .tabbar a').forEach((a) => {
    if (a.getAttribute('href') === section) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  document.title = page === home ? SITE_NAME : `${page.title} · ${SITE_NAME}`;
  main.innerHTML = page.loading();
  try {
    const out = await page.render(params);
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
      main.innerHTML = notice("Couldn't load league data", ' Check your connection and refresh.');
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

// Show the "Admin" link in the header only to signed-in admins.
onUserChange(async () => {
  const link = document.querySelector('.topnav .admin-link');
  if (!link) return;
  try {
    const { admin } = await currentAdmin();
    link.hidden = !admin;
  } catch {
    link.hidden = true;
  }
});

show();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
