// Fixtures & results across every published event, with a heading per round.
// URL options: ?view=upcoming|results  ?event=<id>  ?team=<id>

import { loadAllBundles, loadPeople, isApprovedTeam } from '../data.js';
import { currentUser } from '../auth.js';
import { watchEvent } from '../live.js';
import { esc, skeleton, notice, pageTitle } from '../ui.js';
import { allFixtures, fixturesByRound, resultOf } from './parts.js';

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

export async function render() {
  const params = new URLSearchParams(location.search);
  const view = params.get('view') === 'results' ? 'results' : 'upcoming';
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

  return `
    <div class="page-head">
      ${pageTitle('Fixtures', 'Every match across exhibition nights and tournaments. Times are in your time zone.', 'teal')}
    </div>
    <div class="fixture-filters">
      <nav class="chips">${chip('upcoming', 'Upcoming', upcoming.length)}${chip('results', 'Results', results.length)}${myChip}</nav>
      ${bundles.length > 1 ? `<label class="picker"><span class="sr-only">Event</span><select data-nav>${eventOptions}</select></label>` : ''}
      ${teamIds.length > 1 ? `<label class="picker"><span class="sr-only">Team</span><select data-nav>${teamOptions}</select></label>` : ''}
    </div>
    ${shown.length
      ? `<div class="panel flush fixtures">${fixturesByRound(shown, { showEvent: !eventId })}</div>`
      : teamId
        ? `${notice(view === 'results' ? 'No results for this team yet' : 'Nothing scheduled for this team', '', 'x')}<p class="small" style="text-align:center"><a href="${esc(url({ team: null }))}" data-link>Show every team</a></p>`
        : notice(view === 'results' ? 'No results yet' : 'Nothing scheduled', view === 'results' ? ' Results appear here once matches are played.' : ' New fixtures will show up here.', 'x')}`;
}
