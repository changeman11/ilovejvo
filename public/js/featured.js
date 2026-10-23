// FEATURED! card: the next big event, on the right side of the screen (desktop) or as a banner
// at the top of Home (phones). Shows the name, date, a live countdown, how many have signed up,
// and a button to the event. Admins can pin an event with "Feature this event"; otherwise it's
// the soonest upcoming event. "×" hides it until there's a different featured event.

import { loadAllBundles } from './data.js';
import { esc, urls, fmtDay, fmtTime } from './ui.js';
import { signupsOpen } from './rules/autofix.js';

const HIDE_KEY = 'jvo.featuredHidden';
let el = null;
let timer = null;

const hiddenFor = () => { try { return localStorage.getItem(HIDE_KEY) ?? ''; } catch { return ''; } };

function pick(bundles, now) {
  const upcoming = bundles.filter((b) => b.event.published && b.event.status === 'upcoming' && (!b.event.date || b.event.date > now - 3 * 3600000));
  const pinned = upcoming.find((b) => b.event.featured);
  if (pinned) return pinned;
  return upcoming.filter((b) => b.event.date).sort((a, z) => a.event.date - z.event.date)[0] ?? upcoming[0] ?? null;
}

function countdown(ms, now) {
  if (!ms) return 'Date TBD';
  const d = ms - now;
  if (d <= 0) return 'On now!';
  const days = Math.floor(d / 86400000);
  const hours = Math.floor((d % 86400000) / 3600000);
  const mins = Math.floor((d % 3600000) / 60000);
  if (days) return `in ${days}d ${hours}h`;
  if (hours) return `in ${hours}h ${mins}m`;
  return `in ${mins}m`;
}

export async function updateFeatured() {
  let bundles;
  try { bundles = await loadAllBundles(); } catch { return; }
  const now = Date.now();
  const b = pick(bundles, now);
  if (!b || hiddenFor() === b.event.id) {
    el?.remove();
    el = null;
    clearInterval(timer);
    return;
  }
  const e = b.event;
  const teams = b.plan.teamIds.length;
  const solos = (b.solos ?? []).length;
  const open = signupsOpen(e, now) || (e.solos && signupsOpen({ ...e, signups: true }, now));
  el ??= document.body.appendChild(Object.assign(document.createElement('aside'), { className: 'featured' }));
  el.setAttribute('aria-label', 'Featured event');
  const when = e.date ? `${fmtDay(e.date)}${e.timeTbd ? '' : ` · ${fmtTime(e.date)}`}` : 'Date TBD';
  el.innerHTML = `
    <button class="featured-close" type="button" aria-label="Hide the featured event" title="Hide">×</button>
    <span class="featured-tag">★ featured!</span>
    <a class="featured-body" href="${urls.event(e.id)}" data-link>
      <b class="featured-title">${esc(e.title)}</b>
      <span class="featured-when">${esc(when)}</span>
      <span class="featured-count" data-countdown="${e.date ?? ''}">${esc(countdown(e.date, now))}</span>
      <span class="featured-meta">${teams} club${teams === 1 ? '' : 's'}${solos ? ` · ${solos} solo` : ''} in</span>
    </a>
    <a class="btn btn-sm featured-btn" href="${urls.event(e.id)}" data-link>${open ? 'Sign up' : 'See event'}</a>`;
  el.querySelector('.featured-close').addEventListener('click', () => {
    try { localStorage.setItem(HIDE_KEY, e.id); } catch { /* fine */ }
    updateFeatured();
  });
  clearInterval(timer);
  timer = setInterval(() => {
    const c = el?.querySelector('[data-countdown]');
    if (c) c.textContent = countdown(Number(c.dataset.countdown) || null, Date.now());
  }, 30000);
}
