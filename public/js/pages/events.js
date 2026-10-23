// Public pages: Home, the Events list and one event's page.
// Only published events (and their fixtures/results) ever reach these.

import { loadAllBundles, loadPublicEvents, loadEventBundle, loadPlayers, isApprovedTeam } from '../data.js';
import { homeProfilePrompt, profileState } from './discord-cta.js';
import { menuCards } from '../menu.js';
import { inAClub } from '../shell.js';
import { characterSpot, characterPicker, charactersOn, startCharacters } from '../characters.js';
import { EVENT_TYPES, EVENT_STATUSES, eventDateLabel, sortEvents, isUpcoming } from '../rules/events.js';
import { computeStandings } from '../rules/standings.js';
import { esc, skeleton, notice, pageTitle, safeUrl, fmtNum, teamDot, teamLink, playerLink, paragraphs, urls, fmtDay, fmtTime, managerTag } from '../ui.js';
import { allFixtures, fixtureRow, fixturesByDay, fixturesByRound, resultOf, standingsTable } from './parts.js';
import { signupsOpen, lockTime } from '../rules/autofix.js';
import { currentUser, currentAdmin } from '../auth.js';
import { adminAddEntry, removeEntry } from '../admin-data.js';
import { signUpTeam, withdrawTeam } from '../player-data.js';
import { refresh } from '../nav.js';
import { watchEvent } from '../live.js';
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

// Desktop: the game-style main menu (stacked, tilted cards over the court), like just volleyball's own.
function gameMenu(state, hasClub) {
  return `
    <section class="home-stage desktop-only" aria-label="Main menu">
      <nav class="game-menu">${menuCards(state, { hasClub })}</nav>
      ${characterSpot('on-court')}
      ${characterPicker('on-court')}
    </section>`;
}

export const home = {
  title: 'Home',
  loading: () => skeleton([220, 300]),
  async render() {
    const [bundles, players] = await Promise.all([loadAllBundles(), loadPlayers()]);
    const [state, hasClub] = await Promise.all([profileState(players), inAClub()]);
    const prompt = homeProfilePrompt(state);
    const items = allFixtures(bundles);
    const upcoming = items.filter(({ b, f }) => !b.results[f.id] && isUpcoming(b.event)).slice(0, 6);
    const latest = items.filter(({ b, f }) => resultOf(b, f).check?.ok)
      .sort((x, y) => (y.f.scheduledAt ?? 0) - (x.f.scheduledAt ?? 0)).slice(0, 5);
    const stats = careerStats(bundles);
    // Player names: every bundle shares the same player list, so any bundle will do.
    const any = bundles[0];
    const { upcoming: events } = sortEvents(bundles.map((b) => b.event));

    return `
      ${gameMenu(state, hasClub)}
      <div class="stack home-rest">
        ${prompt ? `<div class="mobile-only">${prompt}</div>` : ''}
        <section class="panel hero mobile-only">
          <div>
            <h1>Just Volleyball Oceania</h1>
            <p class="lead">Fixtures, results and player stats from our exhibition nights and tournaments.</p>
            <div class="event-links" style="margin-top:16px">
              <a class="btn" href="/fixtures" data-link>Fixtures</a>
              <a class="btn" href="/stats" data-link>Player stats</a>
            </div>
          </div>
          <div>
            <div class="hero-art${charactersOn ? ' with-chars' : ''}">
              ${charactersOn ? characterSpot('in-banner') + characterPicker('in-banner') : '<img class="hero-scene" src="/images/art/scene.jpg" alt="A just volleyball player with the ball on a grass court" width="493" height="600">'}
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
  mount(el) {
    startCharacters(el); // community characters take turns on the court
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

// Club sign-ups on the event page. Managers sign up or pull out; everyone sees who's in and when it closes.
let signupCtx = null; // { user, team, entry, eventId }
let shownEventId = null;

async function signupBox(b) {
  const e = b.event;
  signupCtx = null;
  if (!e.signups) return '';
  const open = signupsOpen(e);
  const closes = lockTime(e);
  const [user, adminState] = await Promise.all([currentUser().catch(() => null), currentAdmin().catch(() => null)]);
  const adminUid = adminState?.admin ? adminState.user.uid : null;
  const me = user ? Object.values(b.playersById).find((p) => p.uid === user.uid) : null;
  const team = me?.teamId && isApprovedTeam(b.teamsById[me.teamId]) ? b.teamsById[me.teamId] : null;
  const manager = Boolean(team && team.managerUid === user.uid);
  const entry = team ? b.entries.find((x) => x.teamId === team.id) : null;
  signupCtx = { user, team, entry, eventId: e.id, manager, adminUid, entries: b.entries };
  const managerOf = (t) => (t?.managerPlayerId ? b.playersById[t.managerPlayerId] : null);

  const when = closes ? `Sign-ups close ${fmtDay(closes)} ${fmtTime(closes)} (10 minutes before the start).` : 'Sign-ups stay open until the start time is set.';
  let action = '';
  if (!open) {
    action = `<p class="small signup-line"><b>Sign-ups are closed.</b>${entry ? ` ${esc(team.name)} is in.` : ''}</p>`;
  } else if (manager && entry) {
    action = `<div class="join-box"><span>✓ <b>${esc(team.name)}</b> is signed up.</span> <button class="btn btn-sm" type="button" data-act="withdraw-entry">Pull out</button></div>`;
  } else if (manager) {
    action = `<div class="join-box"><button class="btn btn-primary btn-lg" type="button" data-act="sign-up">Sign up ${esc(team.name)}</button><span class="muted small">You’re the manager of ${esc(team.name)}.</span></div>`;
  } else if (team) {
    const boss = managerOf(team);
    action = `<p class="small signup-line">${entry ? `✓ <b>${esc(team.name)}</b> is signed up.` : `Only your club’s manager can sign <b>${esc(team.name)}</b> up${boss ? `: ask <a href="${urls.player(boss.id)}" data-link>${esc(boss.displayName)}</a>` : ' (your club has no manager yet; ask an admin)'}.`}</p>`;
  } else if (me) {
    action = '<p class="small signup-line">Clubs sign up through their manager. Not in a club? <a href="/club" data-link>Join or start one</a>.</p>';
  } else if (!adminUid) {
    action = '<p class="small signup-line"><button class="btn btn-sm" type="button" data-discord-signin>Sign in with Discord</button> Club managers sign their club up here.</p>';
  }

  // Admins can sign any club up, or take one out.
  let adminTools = '';
  if (adminUid) {
    const inIt = new Set(b.plan.teamIds);
    const options = Object.values(b.teamsById).filter((t) => isApprovedTeam(t) && !inIt.has(t.id)).sort((x, y) => x.name.localeCompare(y.name));
    adminTools = `
      <div class="signup-admin">
        <span class="tag tag-draft">Admin</span>
        ${options.length ? `<select data-admin-team aria-label="Club to sign up">${options.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select>
        <button class="btn btn-sm btn-primary" type="button" data-act="admin-add">Sign this club up</button>` : '<span class="muted small">Every club is in.</span>'}
      </div>`;
  }

  const entered = b.entries.map((x) => b.teamsById[x.teamId]).filter(Boolean);
  const list = entered.length ? `<ul class="signup-list">${entered.map((t) => {
    const boss = managerOf(t);
    return `<li><span class="team">${teamDot(t)}<a href="${urls.team(t.id)}" data-link>${esc(t.name)}</a></span>
      ${boss ? `<span class="muted small">${managerTag()} ${esc(boss.displayName)}</span>` : ''}
      ${adminUid ? `<button class="link-btn small" type="button" data-act="admin-remove" data-id="${esc(t.id)}">Remove</button>` : ''}</li>`;
  }).join('')}</ul>` : '';

  return `
    <section class="panel signup-box">
      <div class="section-head"><h2>Club sign-ups</h2><span class="muted small">${entered.length} club${entered.length === 1 ? '' : 's'} in</span></div>
      ${open ? `<p class="muted small" style="margin:0">${esc(when)}${e.autoFixtures && e.autoFixtures !== 'off' ? ' The fixtures update as clubs sign up, then lock.' : ''}</p>` : ''}
      ${action}
      ${adminTools}
      ${list}
      <p class="form-error" role="alert" hidden></p>
    </section>`;
}

export const eventPage = {
  title: 'Event',
  loading: () => skeleton([180, 320]),
  mount(el) {
    // Clubs joining or leaving, new fixtures and results show up straight away.
    if (shownEventId) watchEvent(shownEventId);
    if (!signupCtx) return;
    const { user, team, entry, eventId, adminUid, entries } = signupCtx;
    el.querySelector('.signup-box')?.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'withdraw-entry' && !window.confirm(`Pull ${team.name} out of this event?`)) return;
      if (act === 'admin-remove' && !window.confirm('Take this club out of the event?')) return;
      btn.disabled = true;
      try {
        if (act === 'sign-up') await signUpTeam({ uid: user.uid, eventId, team });
        if (act === 'withdraw-entry') await withdrawTeam({ uid: user.uid, eventId, entry });
        if (act === 'admin-add') await adminAddEntry({ eventId, uid: adminUid, teamId: el.querySelector('[data-admin-team]').value });
        if (act === 'admin-remove') await removeEntry({ eventId, uid: adminUid, entry: entries.find((x) => x.teamId === btn.dataset.id) });
        refresh();
      } catch (err) {
        console.error(err);
        btn.disabled = false;
        const msg = el.querySelector('.signup-box .form-error');
        msg.textContent = err.code === 'permission-denied' ? 'Sign-ups have closed for this event.' : 'That didn’t save. Check your connection and try again.';
        msg.hidden = false;
      }
    });
  },
  async render({ eventId }) {
    const b = await loadEventBundle(eventId, { fresh: true });
    const e = b.event;
    shownEventId = e.id;
    const signups = await signupBox(b);
    const items = [...b.fixtures].sort((x, y) => (x.scheduledAt ?? Infinity) - (y.scheduledAt ?? Infinity) || (x.order ?? 0) - (y.order ?? 0)).map((f) => ({ b, f }));
    const stats = careerStats([b]);
    const signup = safeUrl(e.signupUrl);
    const stream = safeUrl(e.streamUrl);
    const table = e.showTable && b.teams.length && b.plan.groupCount < 2 ? computeStandings(b).rows : null;
    // Group stage: a table per group (always shown when there are groups).
    const groupTables = b.plan.groupCount > 1 && b.plan.teamIds.length
      ? Object.entries(b.plan.tables).map(([l, t]) => `
        <section><div class="section-head"><h2>Group ${l}</h2>${t.done ? '<span class="tag tag-live">Finished</span>' : ''}</div>
          <div class="panel flush">${t.rows.length ? standingsTable(t.rows, b) : '<p class="muted" style="padding:16px">No teams yet.</p>'}</div></section>`).join('')
      : '';

    return {
      title: e.title,
      html: `
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
          ${signups}

          <div class="cols">
            <div class="stack">
              <section>
                <div class="section-head"><h2>Fixtures &amp; results</h2>${b.plan.virtual.some((f) => f.auto) ? '<span class="tag tag-draft">Draft until the lock</span>' : ''}</div>
                <div class="panel flush fixtures">${items.length ? fixturesByRound(items) : `<p class="muted" style="padding:16px">${e.autoFixtures && e.autoFixtures !== 'off' ? 'Fixtures appear here once two clubs have signed up.' : 'Fixtures haven’t been announced yet.'}</p>`}</div>
                ${b.plan.finalsNote ? `<p class="muted small">${esc(b.plan.finalsNote)}</p>` : ''}
              </section>
              ${table ? `<section><div class="section-head"><h2>Table</h2></div><div class="panel flush">${standingsTable(table, b)}</div></section>` : ''}
              ${groupTables}
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
