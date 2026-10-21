// Public event pages: the home page sections, the Exhibition nights / Tournaments lists,
// and one event's own page. Only published events ever reach these.

import { loadPublicEvents, loadEvent } from '../data.js';
import { EVENT_TYPES, EVENT_STATUSES, eventDateLabel, sortEvents, isUpcoming } from '../rules/events.js';
import { esc, skeleton, notice, safeUrl } from '../ui.js';

// Plain text with blank lines between paragraphs -> safe HTML paragraphs.
export function paragraphs(text) {
  return String(text ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function links(e) {
  const stream = safeUrl(e.streamUrl);
  const signup = safeUrl(e.signupUrl);
  if (!stream && !signup) return '';
  return `<div class="event-links">
    ${signup && isUpcoming(e) ? `<a class="btn btn-sm" href="${esc(signup)}" target="_blank" rel="noopener">${e.type === 'tournament' ? 'Sign up' : 'Join in'}</a>` : ''}
    ${stream ? `<a class="btn btn-ghost btn-sm" href="${esc(stream)}" target="_blank" rel="noopener">▶ ${isUpcoming(e) ? 'Stream' : 'Watch back'}</a>` : ''}
  </div>`;
}

function facts(e) {
  const items = [];
  if (e.type === 'tournament') {
    if (e.format) items.push(['Format', e.format]);
    if (e.teamSize) items.push(['Teams', `${e.teamSize}v${e.teamSize}`]);
    if (e.prize) items.push(['Prize', e.prize]);
  }
  return items.length
    ? `<dl class="facts">${items.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`
    : '';
}

// One event as a card. `href` makes the title a link to its own page.
export function eventCard(e, { link = true } = {}) {
  const status = e.status && e.status !== 'upcoming' ? `<span class="tag tag-${esc(e.status)}">${esc(EVENT_STATUSES[e.status])}</span>` : '';
  const title = link ? `<a href="/event/${encodeURIComponent(e.id)}" data-link>${esc(e.title)}</a>` : esc(e.title);
  return `
    <article class="card event-card event-${esc(e.type)}">
      <div class="event-top">
        <span class="eyebrow">${esc(EVENT_TYPES[e.type]?.label ?? 'Event')}</span>
        ${status}
      </div>
      <h3>${title}</h3>
      <p class="event-date${e.date ? '' : ' tbd'}">${esc(eventDateLabel(e))}</p>
      ${e.summary ? `<p class="event-summary">${esc(e.summary)}</p>` : ''}
      ${facts(e)}
      ${links(e)}
    </article>`;
}

// ---------- Home ----------

export const home = {
  title: 'Home',
  loading: () => `<div class="grid">${skeleton([140, 220, 220])}</div>`,
  async render() {
    const events = await loadPublicEvents();
    const section = (type) => {
      const { upcoming } = sortEvents(events.filter((e) => e.type === type));
      const cfg = EVENT_TYPES[type];
      return `
        <section>
          <div class="section-head"><h2>${type === 'tournament' ? 'Upcoming tournaments' : cfg.plural}</h2><a href="${cfg.path}" data-link>See all →</a></div>
          ${upcoming.length
            ? `<div class="event-grid">${upcoming.slice(0, 3).map((e) => eventCard(e)).join('')}</div>`
            : notice(`No ${cfg.plural.toLowerCase()} announced yet`, ' Check back soon.')}
        </section>`;
    };
    return `
      <section class="hero home-hero">
        <span class="eyebrow">Just Volleyball Oceania</span>
        <h1>I<span>&lt;3</span>JVO</h1>
        <p class="lead">Exhibition nights and tournaments for the Oceania volleyball community.</p>
      </section>
      <div class="grid">
        ${section('exhibition')}
        ${section('tournament')}
      </div>`;
  },
};

// ---------- List pages ----------

function listPage(type) {
  const cfg = EVENT_TYPES[type];
  return {
    title: cfg.plural,
    loading: () => `<div class="grid">${skeleton([60, 220, 220])}</div>`,
    async render() {
      const events = (await loadPublicEvents()).filter((e) => e.type === type);
      const { upcoming, past } = sortEvents(events);
      return `
        <section class="hero">
          <span class="eyebrow">I&lt;3JVO</span>
          <h1>${esc(type === 'tournament' ? 'Upcoming tournaments' : cfg.plural)}</h1>
        </section>
        <div class="grid">
          ${upcoming.length
            ? `<div class="event-grid">${upcoming.map((e) => eventCard(e)).join('')}</div>`
            : notice(`No ${cfg.plural.toLowerCase()} announced yet`, ' Dates are still being worked out. Check back soon.')}
          ${past.length ? `<section><div class="section-head"><h2>Past</h2></div><div class="event-grid">${past.map((e) => eventCard(e)).join('')}</div></section>` : ''}
        </div>`;
    },
  };
}

export const exhibitions = listPage('exhibition');
export const tournaments = listPage('tournament');

// ---------- One event ----------

export const eventPage = {
  title: 'Event',
  loading: () => `<div class="grid">${skeleton([60, 300])}</div>`,
  async render({ eventId }) {
    const e = await loadEvent(eventId);
    const cfg = EVENT_TYPES[e.type] ?? { plural: 'Events', path: '/' };
    return {
      title: e.title,
      html: `
        <a class="back" href="${cfg.path}" data-link>← ${esc(cfg.plural)}</a>
        <div class="grid">
          ${eventCard(e, { link: false })}
          ${e.details ? `<section class="card prose">${paragraphs(e.details)}</section>` : ''}
        </div>`,
    };
  },
};
