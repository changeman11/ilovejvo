// Fixtures & results across every published event, in two views:
// - List (default): one section per event; events with groups get a panel per group and the
//   knockout separately; other events a list under round headings. Filters: Upcoming / Results,
//   event, team ("My team").
// - Groups & bracket: per event with groups or a knockout, the group tables, a seeding map (which
//   group place goes into each knockout match, projected or confirmed) and the finals bracket.
// URL options: ?view=upcoming|results  ?event=<id>  ?team=<id>  ?layout=bracket

import { loadAllBundles, loadPeople, isApprovedTeam } from '../data.js';
import { currentUser } from '../auth.js';
import { watchEvent } from '../live.js';
import { esc, skeleton, notice, pageTitle, urls } from '../ui.js';
import {
  allFixtures, fixturesByRound, resultOf, groupFixturesHtml, groupTablesHtml, bracketHtml, seedingMapHtml, stageOrder,
} from './parts.js';
import { seedingMap } from '../rules/autofix.js';
import { eventDateLabel } from '../rules/events.js';

export const title = 'Fixtures';

let liveIds = [];
export function mount() {
  for (const id of liveIds) watchEvent(id);
}

export function loading() {
  return skeleton([60, 44, 360]);
}

// The signed-in player's club id, or null.
async function myTeamId() {
  const user = await currentUser().catch(() => null);
  if (!user) return null;
  const people = await loadPeople();
  const me = people.players.find((p) => p.uid === user.uid);
  return me?.teamId && isApprovedTeam(people.teamsById[me.teamId]) ? me.teamId : null;
}

const eventHead = (b) => `
  <header class="fx-event-head">
    <a href="${urls.event(b.event.id)}" data-link><b>${esc(b.event.title)}</b></a>
    <span class="muted small">${esc(eventDateLabel(b.event))}</span>
  </header>`;

// List view: one section per event, groups kept apart.
function listView(bundles, shown, view) {
  const byEvent = new Map();
  for (const item of shown) {
    if (!byEvent.has(item.b)) byEvent.set(item.b, []);
    byEvent.get(item.b).push(item);
  }
  return [...byEvent.entries()].map(([b, items]) => {
    const groups = b.plan.groupCount > 1;
    const only = new Set(items.map(({ f }) => f.id));
    const grouped = groups ? items.filter(({ f }) => f.group) : [];
    const ko = items.filter(({ f }) => f.stage === 'playoffs');
    const rest = items.filter(({ f }) => !(groups && f.group) && f.stage !== 'playoffs');
    return `
      <section class="fx-event">
        ${eventHead(b)}
        ${grouped.length ? groupFixturesHtml(b, { only }) : ''}
        ${rest.length ? `<div class="panel flush fixtures">${fixturesByRound(rest)}</div>` : ''}
        ${ko.length ? `<div class="fx-ko"><h3>Finals</h3><div class="panel flush fixtures">${fixturesByRound(view === 'results' ? ko : [...ko].sort((x, y) => stageOrder(x.f, y.f)))}</div></div>` : ''}
      </section>`;
  }).join('');
}

// Groups & bracket view: tables, seeding map and bracket for each event that has them.
function bracketView(bundles) {
  const withStages = bundles.filter((b) => b.plan.groupCount > 1 || (b.event.finals?.type && b.event.finals.type !== 'none'));
  if (!withStages.length) return notice('No events with groups or finals yet', ' When an event has a group stage or a knockout, its tables and bracket show here.', 'x');
  // Upcoming events first, then the most recent.
  withStages.sort((a, z) => (a.event.status === 'upcoming' ? 0 : 1) - (z.event.status === 'upcoming' ? 0 : 1)
    || (a.event.status === 'upcoming' ? (a.event.date ?? Infinity) - (z.event.date ?? Infinity) : (z.event.date ?? 0) - (a.event.date ?? 0)));
  return withStages.map((b) => {
    const hasGroups = b.plan.groupCount > 1 && b.plan.teamIds.length > 0;
    const map = seedingMap(b.event, b.plan);
    const bracket = bracketHtml(b);
    return `
      <section class="fx-event">
        ${eventHead(b)}
        ${hasGroups ? `<h3 class="fx-sub">Group tables</h3>${groupTablesHtml(b)}` : ''}
        ${map ? `<h3 class="fx-sub">Seeding map</h3>${seedingMapHtml(b, map)}` : ''}
        ${bracket ? `<div class="finals-section" style="margin-top:18px"><div class="finals-head"><h2>Finals</h2><span class="br-swipe">Swipe to see the final →</span></div>${bracket}</div>` : ''}
        ${!hasGroups && !map && !bracket ? `<p class="muted">${esc(b.plan.finalsNote ?? 'Nothing to show yet: teams appear here once they’re in.')}</p>` : ''}
        ${b.plan.finalsNote && (map || bracket) ? `<p class="muted small">${esc(b.plan.finalsNote)}</p>` : ''}
      </section>`;
  }).join('');
}

export async function render() {
  const params = new URLSearchParams(location.search);
  const view = params.get('view') === 'results' ? 'results' : 'upcoming';
  const layout = params.get('layout') === 'bracket' ? 'bracket' : 'list';
  const [bundles, mine] = await Promise.all([loadAllBundles(), myTeamId()]);
  // Upcoming events with sign-ups or auto fixtures update live (see mount).
  liveIds = bundles.filter((b) => b.event.status === 'upcoming' && (b.event.signups || (b.event.autoFixtures ?? 'off') !== 'off')).map((b) => b.event.id);
  const eventId = bundles.some((b) => b.event.id === params.get('event')) ? params.get('event') : null;
  const inEvents = eventId ? bundles.filter((b) => b.event.id === eventId) : bundles;

  // Teams that have at least one fixture in the events shown (for the team picker).
  const teamsById = Object.assign({}, ...bundles.map((b) => b.teamsById));
  const teamIds = [...new Set(inEvents.flatMap((b) => b.fixtures.flatMap((f) => [f.homeTeamId, f.awayTeamId])))].filter((id) => teamsById[id]);
  const teamId = teamsById[params.get('team')] ? params.get('team') : null;

  const items = allFixtures(inEvents).filter(({ f }) => !teamId || f.homeTeamId === teamId || f.awayTeamId === teamId);
  const upcoming = items.filter(({ b, f }) => !b.results[f.id]);
  const results = items.filter(({ b, f }) => resultOf(b, f).result).reverse(); // newest first
  const shown = view === 'results' ? results : upcoming;

  const url = (changes) => {
    const q = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(changes)) (v ? q.set(k, v) : q.delete(k));
    const s = q.toString();
    return `/fixtures${s ? `?${s}` : ''}`;
  };
  const chip = (v, label, count) => `<a class="chip-link" href="${esc(url({ view: v === 'upcoming' ? null : v }))}" data-link data-keep-scroll${v === view ? ' aria-current="true"' : ''}>${label} <span class="muted">&nbsp;${count}</span></a>`;
  const eventOptions = [
    `<option value="${esc(url({ event: null }))}">All events</option>`,
    ...bundles.map((b) => `<option value="${esc(url({ event: b.event.id }))}"${b.event.id === eventId ? ' selected' : ''}>${esc(b.event.title)}</option>`),
  ].join('');
  const teamOptions = [
    `<option value="${esc(url({ team: null }))}">All teams</option>`,
    ...teamIds
      .sort((a, z) => teamsById[a].name.localeCompare(teamsById[z].name))
      .map((id) => `<option value="${esc(url({ team: id }))}"${id === teamId ? ' selected' : ''}>${esc(teamsById[id].name)}${id === mine ? ' (my team)' : ''}</option>`),
  ].join('');
  const myChip = mine
    ? `<a class="chip-link" href="${esc(url({ team: teamId === mine ? null : mine }))}" data-link data-keep-scroll${teamId === mine ? ' aria-current="true"' : ''}>★ My team</a>`
    : '';
  const layoutSwitch = `
    <nav class="layout-switch" aria-label="View">
      <a href="${esc(url({ layout: null }))}" data-link data-keep-scroll${layout === 'list' ? ' aria-current="true"' : ''}>📋 List</a>
      <a href="${esc(url({ layout: 'bracket' }))}" data-link data-keep-scroll${layout === 'bracket' ? ' aria-current="true"' : ''}>🏆 Groups &amp; bracket</a>
    </nav>`;

  let body;
  if (layout === 'bracket') {
    body = bracketView(inEvents);
  } else if (shown.length) {
    body = listView(inEvents, shown, view);
  } else if (teamId) {
    body = `${notice(view === 'results' ? 'No results for this team yet' : 'Nothing scheduled for this team', '', 'x')}<p class="small" style="text-align:center"><a href="${esc(url({ team: null }))}" data-link>Show every team</a></p>`;
  } else {
    body = notice(view === 'results' ? 'No results yet' : 'Nothing scheduled', view === 'results' ? ' Results appear here once matches are played.' : ' New fixtures will show up here.', 'x');
  }

  return `
    <div class="page-head">
      ${pageTitle('Fixtures', 'Every match across exhibition nights and tournaments. Times are in your time zone.', 'teal')}
      ${layoutSwitch}
    </div>
    <div class="fixture-filters">
      ${layout === 'list' ? `<nav class="chips">${chip('upcoming', 'Upcoming', upcoming.length)}${chip('results', 'Results', results.length)}${myChip}</nav>` : ''}
      ${bundles.length > 1 ? `<label class="picker"><span class="sr-only">Event</span><select data-nav>${eventOptions}</select></label>` : ''}
      ${layout === 'list' && teamIds.length > 1 ? `<label class="picker"><span class="sr-only">Team</span><select data-nav>${teamOptions}</select></label>` : ''}
    </div>
    ${body}`;
}

