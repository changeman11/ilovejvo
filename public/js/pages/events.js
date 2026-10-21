// Public pages: Home, the Events list and one event's page.
// Only published events (and their fixtures/results) ever reach these.

import { loadAllBundles, loadPublicEvents, loadEventBundle, loadPlayers } from '../data.js';
import { homeProfilePrompt } from './discord-cta.js';
import { EVENT_TYPES, EVENT_STATUSES, eventDateLabel, sortEvents, isUpcoming } from '../rules/events.js';
import { computeStandings } from '../rules/standings.js';
import { esc, skeleton, notice, pageTitle, safeUrl, fmtNum, teamDot, teamLink, playerLink, paragraphs, urls } from '../ui.js';
import { allFixtures, fixtureRow, fixturesByDay, resultOf, standingsTable } from './parts.js';
import { careerStats, topPlayers, statDefsFor } from './career.js';

// ---------- Shared bits ----------

function tags(e) {
  return `<div class="event-top">
    <span class="tag tag-${esc(e.type)}">${esc(EVENT_TYPES[e.type]?.label ?? 'Event')}</span>
    ${e.status !== 'upcoming' ? `<span class="tag tag-${esc(e.status)}">${esc(EVENT_STATUSES[e.status])}</span>` : ''}
  </div>`;
}

function facts(e) {
  const items = [];
  if (e.teamSize) items.push(['Teams', `${e.teamSize}v${e.teamSize}`]);
  if (e.formatNote) items.push(['Format', e.formatNote]);
  if (e.prize) items.push(['Prize', e.prize]);
  return items.length ? `<dl class="facts">${items.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : '';
}

function eventCard(e) {
  return `
    <a class="panel event-card" href="${urls.event(e.id)}" data-link>
      ${tags(e)}
      <h3>${esc(e.title)}</h3>
      <p class="event-when${e.date ? '' : ' tbd'}">${esc(eventDateLabel(e))}</p>
      ${e.summary ? `<p class="muted">${esc(e.summary)}</p>` : ''}
      ${facts(e)}
    </a>`;
}

// Leader lists (one per stat) from career/event stats.
function leaders(stats, b, keys, { limit = 3 } = {}) {
  const defs = statDefsFor(b ? [b] : []);
  const blocks = keys.map((key) => {
    const def = defs.find((d) => d.key === key) ?? { key, name: key.toUpperCase() };
    const top = topPlayers(stats, key, { limit });
    if (!top.length) return '';
    return `<div class="leader"><h3>${esc(def.name)}</h3><ol>${top.map(({ p, v }) => `<li>${playerLink(b?.playersById[p.playerId] ?? { id: p.playerId, displayName: p.playerId }, p.playerId)}<b class="num">${fmtNum(v)}</b></li>`).join('')}</ol></div>`;
  }).join('');
  return blocks ? `<div class="leaders">${blocks}</div>` : '<p class="muted">No stats yet.</p>';
}

// ---------- Home ----------

export const home = {
  title: 'Home',
  loading: () => skeleton([220, 300]),
  async render() {
    const [bundles, players] = await Promise.all([loadAllBundles(), loadPlayers()]);
    const prompt = await homeProfilePrompt({ hasProfile: (uid) => players.some((p) => p.uid === uid) });
    const items = allFixtures(bundles);
    const upcoming = items.filter(({ b, f }) => !b.results[f.id] && isUpcoming(b.event)).slice(0, 6);
    const latest = items.filter(({ b, f }) => resultOf(b, f).check?.ok)
      .sort((x, y) => (y.f.scheduledAt ?? 0) - (x.f.scheduledAt ?? 0)).slice(0, 5);
    const stats = careerStats(bundles);
    // Player names: every bundle shares the same player list, so any bundle will do.
    const any = bundles[0];
    const { upcoming: events } = sortEvents(bundles.map((b) => b.event));

    return `
      <div class="stack">
        ${prompt}
        <section class="panel hero">
          <div>
            <h1>Just Volleyball Oceania</h1>
            <p class="lead">Fixtures, results and player stats from our exhibition nights and tournaments.</p>
            <div class="event-links" style="margin-top:16px">
              <a class="btn" href="/fixtures" data-link>Fixtures</a>
              <a class="btn" href="/stats" data-link>Player stats</a>
            </div>
          </div>
          <div>
            <div class="hero-art">
              <img class="hero-scene" src="/images/art/scene.jpg" alt="A just volleyball player with the ball on a grass court" width="493" height="600">
              <picture class="hero-logo">
                <source srcset="/images/game/just-volleyball-logo-wide.avif" type="image/avif">
                <img src="/images/game/just-volleyball-logo.jpg" alt="just volleyball" width="460" height="215">
              </picture>
            </div>
            <p class="credit">just volleyball © temkosoft · <a href="https://store.steampowered.com/app/5037200/" target="_blank" rel="noopener">Get it on Steam</a></p>
          </div>
        </section>

        <div class="cols">
          <div class="stack">
            <section>
              <div class="section-head"><h2>Next up</h2><a href="/fixtures" data-link>All fixtures</a></div>
              <div class="panel flush fixtures">${upcoming.map(({ b, f }) => fixtureRow(b, f, { showEvent: true })).join('') || '<p class="muted" style="padding:16px">No fixtures scheduled yet.</p>'}</div>
            </section>
            ${latest.length ? `
            <section>
              <div class="section-head"><h2>Latest results</h2><a href="/fixtures?view=results" data-link>All results</a></div>
              <div class="panel flush fixtures">${latest.map(({ b, f }) => fixtureRow(b, f, { showEvent: true })).join('')}</div>
            </section>` : ''}
          </div>
          <div class="stack">
            <section>
              <div class="section-head"><h2>Top players</h2><a href="/stats" data-link>All stats</a></div>
              <div class="panel">${any ? leaders(stats, any, ['pts', 'spk', 'blk', 'ace']) : '<p class="muted">No stats yet.</p>'}</div>
            </section>
            <section>
              <div class="section-head"><h2>Events</h2><a href="/events" data-link>All events</a></div>
              <div class="panel flush rows">${events.slice(0, 4).map((e) => `
                <a class="row" href="${urls.event(e.id)}" data-link>
                  <span class="row-main"><b>${esc(e.title)}</b><span class="muted small">${esc(eventDateLabel(e))}</span></span>
                  <span class="tag tag-${esc(e.type)}">${esc(EVENT_TYPES[e.type]?.label)}</span>
                </a>`).join('') || '<p class="muted" style="padding:16px">No events announced yet.</p>'}</div>
            </section>
          </div>
        </div>
      </div>`;
  },
};

// ---------- Events list ----------

export const eventsList = {
  title: 'Events',
  loading: () => skeleton([60, 240]),
  async render() {
    const type = new URLSearchParams(location.search).get('type');
    const all = await loadPublicEvents();
    const { upcoming, past } = sortEvents(all.filter((e) => !EVENT_TYPES[type] || e.type === type));
    const chip = (t, label) => `<a class="chip-link" href="/events${t ? `?type=${t}` : ''}" data-link data-keep-scroll${(t || null) === (EVENT_TYPES[type] ? type : null) ? ' aria-current="true"' : ''}>${label}</a>`;
    return `
      <div class="page-head">${pageTitle('Events', 'Exhibition nights and tournaments.', 'pink')}</div>
      <nav class="chips">${chip('', 'All')}${chip('exhibition', 'Exhibition nights')}${chip('tournament', 'Tournaments')}</nav>
      <div class="stack">
        ${upcoming.length ? `<div class="event-list">${upcoming.map(eventCard).join('')}</div>` : notice('Nothing announced yet', ' Dates are still being worked out. Check back soon.', 'green')}
        ${past.length ? `<section><div class="section-head"><h2>Past events</h2></div><div class="event-list">${past.map(eventCard).join('')}</div></section>` : ''}
      </div>`;
  },
};

// ---------- One event ----------

export const eventPage = {
  title: 'Event',
  loading: () => skeleton([180, 320]),
  async render({ eventId }) {
    const b = await loadEventBundle(eventId);
    const e = b.event;
    const items = [...b.fixtures].sort((x, y) => (x.scheduledAt ?? Infinity) - (y.scheduledAt ?? Infinity) || (x.order ?? 0) - (y.order ?? 0)).map((f) => ({ b, f }));
    const stats = careerStats([b]);
    const signup = safeUrl(e.signupUrl);
    const stream = safeUrl(e.streamUrl);
    const table = e.showTable && b.teams.length ? computeStandings(b).rows : null;

    return {
      title: e.title,
      html: `
        <a class="back" href="/events" data-link>← Events</a>
        <div class="stack">
          <section class="panel">
            ${tags(e)}
            <h1 style="margin-top:8px">${esc(e.title)}</h1>
            <p class="event-when${e.date ? '' : ' tbd'}" style="margin-top:6px">${esc(eventDateLabel(e))}</p>
            ${e.summary ? `<p style="margin-top:8px">${esc(e.summary)}</p>` : ''}
            <div style="margin-top:10px">${facts(e)}</div>
            ${signup || stream ? `<div class="event-links" style="margin-top:14px">
              ${signup && isUpcoming(e) ? `<a class="btn btn-primary" href="${esc(signup)}" target="_blank" rel="noopener">${e.type === 'tournament' ? 'Sign up' : 'Join in'}</a>` : ''}
              ${stream ? `<a class="btn" href="${esc(stream)}" target="_blank" rel="noopener">▶ ${isUpcoming(e) ? 'Watch live' : 'Watch back'}</a>` : ''}
            </div>` : ''}
          </section>

          <div class="cols">
            <div class="stack">
              <section>
                <div class="section-head"><h2>Fixtures &amp; results</h2></div>
                <div class="panel flush fixtures">${items.length ? fixturesByDay(items) : '<p class="muted" style="padding:16px">Fixtures haven’t been announced yet.</p>'}</div>
              </section>
              ${table ? `<section><div class="section-head"><h2>Table</h2></div><div class="panel flush">${standingsTable(table, b)}</div></section>` : ''}
            </div>
            <div class="stack">
              <section>
                <div class="section-head"><h2>Top players</h2><a href="/stats?event=${encodeURIComponent(e.id)}" data-link>Full stats</a></div>
                <div class="panel">${leaders(stats, b, ['pts', 'spk', 'blk', 'ace'])}</div>
              </section>
              ${b.teams.length ? `<section><div class="section-head"><h2>Teams</h2></div><div class="panel flush rows">${b.teams.map((t) => {
                const roster = (b.rosters[t.id]?.playerIds ?? []).map((pid) => playerLink(b.playersById[pid], pid)).join(', ');
                return `<div class="row"><span class="row-main"><b>${teamLink(t)}</b><span class="small">${roster || '<span class="muted">Roster TBD</span>'}</span></span></div>`;
              }).join('')}</div></section>` : ''}
              ${e.details ? `<section><div class="section-head"><h2>Details</h2></div><div class="panel prose">${paragraphs(e.details)}</div></section>` : ''}
            </div>
          </div>
        </div>`,
    };
  },
};
