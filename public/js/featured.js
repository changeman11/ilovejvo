// FEATURED! card: the next big event. A full card top right on wide screens (≥1800px), a two-line
// pill bottom right otherwise. Shows the name, the start in the viewer's own time zone (named, e.g.
// "6:00 pm AEDT" or "Auckland time"), a countdown that ticks every second, how many have signed up,
// and a button to the event. Admins can pin an event with "Feature this event"; otherwise it's the
// soonest upcoming event. "×" folds it into a small ★ tab (remembered per event on this device);
// pressing the tab opens it again, so it never disappears for good.

import { loadAllBundles } from './data.js';
import { esc, urls, fmtDay, fmtTime } from './ui.js';
import { signupsOpen } from './rules/autofix.js';
import { zoneLabel, countdownParts } from './rules/events.js';
import { liveSummary } from './rules/flow.js';
import { phaseText } from './pages/live-parts.js';
import { watchLiveEvent } from './live.js';

const FOLD_KEY = 'jvo.featuredHidden'; // id of the event folded away on this device
const LIVE_FOR = 3 * 3600000; // shown as "live now" for 3 hours after the start
let el = null;
let timer = null;

const foldedFor = () => { try { return localStorage.getItem(FOLD_KEY) ?? ''; } catch { return ''; } };
const setFolded = (id) => { try { id ? localStorage.setItem(FOLD_KEY, id) : localStorage.removeItem(FOLD_KEY); } catch { /* fine */ } };

function pick(bundles, now) {
  // An event that's running (rules/flow.js) comes first: the card becomes its live board.
  const running = bundles.filter((b) => b.event.published && liveSummary(b, now));
  if (running.length) return running.find((b) => b.event.featured) ?? running[0];
  const upcoming = bundles.filter((b) => b.event.published && b.event.status === 'upcoming' && (!b.event.date || b.event.date > now - LIVE_FOR));
  const pinned = upcoming.find((b) => b.event.featured);
  if (pinned) return pinned;
  return upcoming.filter((b) => b.event.date).sort((a, z) => a.event.date - z.event.date)[0] ?? upcoming[0] ?? null;
}

// ---------- The viewer's own time zone ----------

// "Today", "Tomorrow", or "Sat, 25 Oct", in the viewer's time zone.
function dayLabel(ms, now) {
  const start = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const days = Math.round((start(ms) - start(now)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return fmtDay(ms);
}

const longFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZoneName: 'long' });

// ---------- Countdown ----------

function countdownHtml(e, now) {
  if (!e.date || e.timeTbd) return '<span class="featured-count tbd">Time TBD</span>';
  const c = countdownParts(e.date, now);
  return `
    <span class="featured-count${c.live ? ' live' : ''}" data-countdown="${e.date}" role="timer" aria-live="off">
      <span class="fc-short">${c.live ? '<i class="fc-dot"></i>' : '⏱ '}${esc(c.short)}</span>
      <span class="fc-boxes">${c.live ? '<b class="fc-live"><i class="fc-dot"></i> live now</b>' : c.parts.map(([v, l]) => `<span class="fc-box"><b class="num">${v}</b><small>${l}</small></span>`).join('')}</span>
    </span>`;
}

function tick() {
  if (!el) return;
  const now = Date.now();
  const mini = el.querySelector('.fc-mini'); // folded ★ tab
  if (mini) { mini.textContent = countdownParts(Number(mini.dataset.at), now).short; return; }
  const c = el.querySelector('[data-countdown]');
  if (!c) return;
  const ms = Number(c.dataset.countdown);
  const parts = countdownParts(ms, now);
  if (parts.live !== c.classList.contains('live')) { updateFeatured(); return; } // it just started: redraw
  if (parts.live) return;
  c.querySelector('.fc-short').textContent = `⏱ ${parts.short}`;
  const boxes = c.querySelectorAll('.fc-box b');
  if (boxes.length === parts.parts.length) parts.parts.forEach(([v], i) => { boxes[i].textContent = v; });
  else c.outerHTML = countdownHtml({ date: ms }, now); // the last day ran out: one box fewer
}

// ---------- Drawing ----------

export async function updateFeatured() {
  let bundles;
  try { bundles = await loadAllBundles(); } catch { return; }
  const now = Date.now();
  const b = pick(bundles, now);
  clearInterval(timer);
  if (!b) {
    el?.remove();
    el = null;
    return;
  }
  const e = b.event;
  const live = liveSummary(b, now);
  // Watch it live from 2 hours before the start, so scores show up as they're confirmed.
  if (live || (e.date && e.date - now < 2 * 3600000)) watchLiveEvent(e.id, updateFeatured);
  el ??= document.body.appendChild(Object.assign(document.createElement('aside'), { className: 'featured' }));
  el.setAttribute('aria-label', 'Featured event');

  // Folded: a small ★ tab with the time left; pressing it opens the card again.
  if (foldedFor() === e.id) {
    el.className = 'featured folded';
    const mini = live ? 'live' : e.date && !e.timeTbd ? countdownParts(e.date, now).short : '';
    el.innerHTML = `<button class="featured-open" type="button" title="Show the featured event: ${esc(e.title)}" aria-label="Show the featured event">★${mini ? ` <span class="fc-mini num" data-at="${e.date}">${esc(mini)}</span>` : ''}</button>`;
    el.querySelector('.featured-open').addEventListener('click', () => { setFolded(''); updateFeatured(); });
    if (mini && !live) timer = setInterval(tick, 1000);
    return;
  }

  if (live) return drawLive(b, live, now);

  el.className = 'featured';
  const teams = b.plan.teamIds.length;
  const solos = (b.solos ?? []).length;
  const open = signupsOpen(e, now) || (e.solos && signupsOpen({ ...e, signups: true }, now));
  const when = !e.date ? 'Date TBD'
    : e.timeTbd ? `${dayLabel(e.date, now)} · time TBD`
      : `${dayLabel(e.date, now)} · ${fmtTime(e.date)} ${zoneLabel(e.date)}`;
  const whenTitle = e.date && !e.timeTbd ? `Starts ${longFmt.format(e.date)} (your local time)` : '';
  el.innerHTML = `
    <button class="featured-close" type="button" aria-label="Fold the featured event away" title="Fold away">×</button>
    <span class="featured-tag">★<span class="ft-word"> featured!</span></span>
    <a class="featured-body" href="${urls.event(e.id)}" data-link>
      <b class="featured-title">${esc(e.title)}</b>
      <span class="featured-info">
        <span class="featured-when"${whenTitle ? ` title="${esc(whenTitle)}"` : ''}>${esc(when)}</span>
        ${countdownHtml(e, now)}
      </span>
      <span class="featured-meta">${teams} club${teams === 1 ? '' : 's'}${solos ? ` · ${solos} solo` : ''} in</span>
    </a>
    <a class="btn btn-sm featured-btn" href="${urls.event(e.id)}" data-link>${open ? 'Sign up' : 'See event'}</a>`;
  el.querySelector('.featured-close').addEventListener('click', () => { setFolded(e.id); updateFeatured(); });
  if (e.date && !e.timeTbd) timer = setInterval(tick, 1000);
}

// The live board: stage, matches on now, latest scores (and the break countdown).
function drawLive(b, live, now) {
  const e = b.event;
  const sn = (id) => esc(b.teamsById[id]?.shortName ?? b.teamsById[id]?.name ?? 'TBC');
  const sets = (f) => {
    const r = b.results[f.id];
    const won = (side) => (r?.sets ?? []).filter((x) => (side === 'home' ? x.home > x.away : x.away > x.home)).length;
    return `${won('home')}–${won('away')}`;
  };
  el.className = 'featured is-live';
  el.innerHTML = `
    <button class="featured-close" type="button" aria-label="Fold the live board away" title="Fold away">×</button>
    <span class="featured-tag live-tag"><i class="live-dot"></i> live</span>
    <a class="featured-body" href="${urls.event(e.id)}" data-link>
      <b class="featured-title">${esc(e.title)}</b>
      <span class="featured-info">
        <span class="featured-when">${esc(phaseText(live))}</span>
        ${live.phase === 'break' && live.breakEndsAt ? countdownHtml({ date: live.breakEndsAt }, now) : ''}
      </span>
      <span class="featured-live">
        ${live.open.length ? `<span class="fl-h">On now</span>${live.open.slice(0, 4).map((f) => `<span class="fl-row">${sn(f.homeTeamId)} <i>v</i> ${sn(f.awayTeamId)}</span>`).join('')}` : ''}
        ${live.recent.length ? `<span class="fl-h">Just in</span>${live.recent.slice(0, 3).map((f) => `<span class="fl-row">${sn(f.homeTeamId)} <b class="num">${sets(f)}</b> ${sn(f.awayTeamId)}</span>`).join('')}` : ''}
      </span>
    </a>
    <a class="btn btn-sm featured-btn" href="${urls.event(e.id)}" data-link>Follow live</a>`;
  el.querySelector('.featured-close').addEventListener('click', () => { setFolded(e.id); updateFeatured(); });
  if (live.phase === 'break' && live.breakEndsAt) timer = setInterval(tick, 1000);
}
