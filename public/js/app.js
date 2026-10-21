// App shell: picks the page for the current URL and draws it.
// Links with data-link switch pages without a full reload.
// <select data-nav> dropdowns navigate to the URL in their value.

import * as events from './pages/events.js';
import * as fixtures from './pages/fixtures.js';
import * as stats from './pages/stats.js';
import * as match from './pages/match.js';
import * as player from './pages/player.js';
import * as me from './pages/me.js';
import * as manage from './pages/manage.js';
import * as authCallback from './pages/auth-callback.js';
import * as requests from './pages/admin/requests.js';
import * as adminHome from './pages/admin/home.js';
import * as eventEdit from './pages/admin/event-edit.js';
import * as people from './pages/admin/people.js';
import * as resultEntry from './pages/admin/result.js';
import { NotFoundError } from './data.js';
import { onAdminChange, currentAdmin } from './auth.js';
import { setNav } from './nav.js';
import { notice } from './ui.js';

// Path patterns. ":name" parts are passed to the page's render() as params.
// `section` is the menu item to highlight.
const routes = [
  { path: '/', page: events.home, section: '/' },
  { path: '/fixtures', page: fixtures, section: '/fixtures' },
  { path: '/stats', page: stats, section: '/stats' },
  { path: '/events', page: events.eventsList, section: '/events' },
  { path: '/event/:eventId', page: events.eventPage, section: '/events' },
  { path: '/match/:eventId/:fixtureId', page: match, section: '/fixtures' },
  { path: '/player/:playerId', page: player, section: '/stats' },
  { path: '/me', page: me, section: '/me' },
  { path: '/manage', page: manage, section: '/me' },
  { path: '/auth/discord', page: authCallback, section: '/me' },
  { path: '/admin', page: adminHome, section: '/admin' },
  { path: '/admin/requests', page: requests, section: '/admin' },
  { path: '/admin/people', page: people, section: '/admin' },
  { path: '/admin/event/:eventId', page: eventEdit, section: '/admin' },
  { path: '/admin/result/:eventId/:fixtureId', page: resultEntry, section: '/admin' },
];

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
    history.replaceState(null, '', redirects[path]);
    return show();
  }
  const { page, params, section } = matchRoute(path);
  const id = ++renderId;

  document.querySelectorAll('.topnav a, .tabbar a').forEach((a) => {
    if (a.getAttribute('href') === section) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  document.title = page === events.home ? SITE_NAME : `${page.title} · ${SITE_NAME}`;
  main.innerHTML = page.loading();
  try {
    const out = await page.render(params);
    if (id !== renderId) return; // the user already moved on
    const { html, title } = typeof out === 'string' ? { html: out } : out;
    main.innerHTML = html;
    if (title) document.title = `${title} · ${SITE_NAME}`;
    page.mount?.(main);
  } catch (err) {
    if (id !== renderId) return;
    if (err instanceof NotFoundError) {
      main.innerHTML = notice('Not found', ` ${err.message}.`, 'x');
    } else {
      console.error(err);
      main.innerHTML = notice('Couldn’t load this page', ' Check your connection and refresh.', 'x');
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
