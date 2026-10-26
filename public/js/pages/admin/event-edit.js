// Admin: one event, in three tabs.
//   Details          title, dates (TBD allowed), links, visibility
//   Teams & rosters  which teams take part, and who plays for each
//   Fixtures         add/edit/delete matches (dates TBD allowed), enter results
// /admin/event/new?type=exhibition  or  /admin/event/<id>?tab=details|teams|fixtures[&edit=<fixtureId>|new]

import { loadEventBundle, loadPeople, NotFoundError } from '../../data.js';
import {
  EVENT_TYPES, EVENT_STATUSES, validateEvent, dateFromInputs, inputsFromDate, eventDateLabel,
} from '../../rules/events.js';
import { AUTO_MODES, FINALS_TYPES, GROUP_DRAWS, LETTERS, lockTime, isLocked, schedulePlan, drawToSave, matchCount, groupCount, suggestSetup, suggestionText } from '../../rules/autofix.js';
import { syncSchedules } from '../../admin-sync.js';
import { FLOW_DEFAULTS, flowOf, eventPhase, liveSummary } from '../../rules/flow.js';
import { zoneLabel } from '../../rules/events.js';
import { ELIM_PREFIXES, nextLabel, elimRound } from '../../rules/bracket-labels.js';
import { fillElimination, pendingRound } from '../../rules/elim-fill.js';
import { saveElimByes } from '../../admin-data.js';
import { saveEvent, saveFlow, deleteEvent, saveRoster, saveFixture, deleteFixture, saveSchedule, removeEntry, clearFixtures, makeMixTeams, breakUpMixTeam } from '../../admin-data.js';
import { navigate, refresh } from '../../nav.js';
import { esc, skeleton, fmtDay, fmtTime, teamDot, urls } from '../../ui.js';
import { resultOf, stageOrder } from '../parts.js';
import { adminGate, adminBar, bindAuthActions } from './gate.js';

export const title = 'Edit event';

export function loading() {
  return skeleton([50, 60, 420]);
}

let page = null; // { id, existing, b, people, user, tab }

const opt = (value, label, current) => `<option value="${esc(value)}"${String(value) === String(current ?? '') ? ' selected' : ''}>${esc(label)}</option>`;

// The stored event without bookkeeping fields, plus changes.
function payload(changes = {}) {
  const { id, createdAt, createdBy, updatedAt, updatedBy, ...rest } = page.existing ?? {};
  return { teamIds: [], ...rest, ...changes };
}

// ---------- Details tab ----------

// The suggested setup for the teams in the event, with a "Use suggestion" button (fills the form;
// Save details keeps it). With no teams yet, a rough guide instead.
function groupSuggestion(e) {
  const teams = page?.b?.plan?.teamIds?.length ?? 0;
  if (teams < 2) {
    return '<p class="small" style="margin:0">💡 <b>Rough guide</b> (groups of about 4): 6–9 teams → 2 groups · 10–13 → 3 · 14–17 → 4 · 18–21 → 5 · up to 32 → 8. A suggestion appears here once teams are in.</p>';
  }
  const s = suggestSetup(teams, { double: e.autoFixtures === 'double' });
  const same = groupCount(e) === s.groups && (e.finals?.type ?? 'none') === s.knockout;
  return `<p class="small" style="margin:0">💡 <b>Suggested:</b> ${esc(suggestionText(teams, { double: e.autoFixtures === 'double' }))}.</p>
    ${same ? '<p class="small" style="margin:4px 0 0">✓ That’s what this event is set to.</p>'
      : `<button type="button" class="btn btn-sm" data-act="use-suggestion" data-groups="${s.groups}" data-knockout="${s.knockout}" style="margin-top:6px">Use suggestion</button>`}`;
}

// "12 teams in 3 groups: 18 matches (everyone plays everyone: 66)", for the Rule config.
function groupHint(e) {
  const teams = page?.b?.plan?.teamIds?.length ?? 0;
  const n = groupCount(e);
  if (!teams) return n > 1 ? `Teams are split into ${n} groups; each group plays its own round robin.` : 'Everyone plays everyone.';
  const all = matchCount({ ...e, groups: { count: 1 } }, teams);
  return n > 1
    ? `${teams} teams in ${n} groups: ${matchCount(e, teams)} group matches (everyone plays everyone would be ${all}).`
    : `${teams} teams: ${all} matches.`;
}

function detailsHtml(e) {
  const { dateStr, timeStr } = inputsFromDate(e.date, e.timeTbd);
  const isTournament = e.type === 'tournament';
  return `
    <form class="stack" data-form="details" novalidate>
      <section class="panel">
        <label class="field"><span>Type</span><select name="type">${Object.entries(EVENT_TYPES).map(([k, v]) => opt(k, v.label, e.type)).join('')}</select></label>
        <label class="field"><span>Title</span><input type="text" name="title" maxlength="120" value="${esc(e.title ?? '')}" placeholder="${isTournament ? 'e.g. Opening Cup' : 'e.g. Friday Showmatch Night'}"></label>
        <label class="field"><span>Short summary (shown on cards)</span><textarea name="summary" rows="2" maxlength="280">${esc(e.summary ?? '')}</textarea></label>
        <label class="field" style="margin:0"><span>Details (event page; blank line between paragraphs)</span><textarea name="details" rows="5">${esc(e.details ?? '')}</textarea></label>
      </section>
      <section class="panel">
        <div class="section-head"><h3>When</h3><span class="muted small date-preview">${esc(eventDateLabel(e))}</span></div>
        <div class="field-row">
          <label class="field"><span>Date (empty = TBD)</span><input type="date" name="date" value="${esc(dateStr)}"></label>
          <label class="field"><span>Time (empty = TBD)</span><input type="time" name="time" value="${esc(timeStr)}"></label>
        </div>
        <button type="button" class="link-btn" data-act="clear-date">Set back to TBD</button>
      </section>
      <section class="panel rule-config">
        <div class="section-head"><h3>Rule config</h3></div>
        <p class="muted small" style="margin-top:0">The fixtures build themselves from these rules and the teams in the event, and update whenever either changes, until 10 minutes before the start.</p>
        <div class="field-row">
          <label class="field"><span>Players per team</span><input type="number" name="teamSize" min="1" max="12" inputmode="numeric" value="${esc(e.teamSize ?? 4)}"></label>
          <label class="field"><span>Matches are best of</span><select name="bestOf">${[3, 5].map((n) => opt(n, String(n), e.matchFormat?.bestOf ?? 3)).join('')}</select></label>
        </div>
        <label class="field"><span>Fixtures</span><select name="autoFixtures">${Object.entries(AUTO_MODES).map(([k, v]) => opt(k, v, e.autoFixtures ?? 'off')).join('')}</select></label>
        <div class="field-row">
          <label class="field"><span>Groups</span><select name="groupCount">${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => opt(n, n === 1 ? 'No groups (everyone plays everyone)' : `${n} groups`, e.groups?.count ?? 1)).join('')}</select></label>
          <label class="field"><span>Group draw</span><select name="groupDraw">${Object.entries(GROUP_DRAWS).map(([k, v]) => opt(k, v, e.groups?.draw ?? 'auto')).join('')}</select></label>
        </div>
        <p class="muted small group-hint" style="margin-top:-6px">${esc(groupHint(e))}</p>
        <div class="group-suggest">${groupSuggestion(e)}</div>
        <div class="field-row">
          <label class="field"><span>Knockout</span><select name="finalsType">${Object.entries(FINALS_TYPES).map(([k, v]) => opt(k, v, e.finals?.type ?? 'none')).join('')}</select></label>
          <label class="field"><span>Quarter / semi-finals best of</span><select name="semiBestOf">${[3, 5].map((n) => opt(n, String(n), e.finals?.semiBestOf ?? 3)).join('')}</select></label>
          <label class="field"><span>Final best of</span><select name="finalBestOf">${[3, 5].map((n) => opt(n, String(n), e.finals?.finalBestOf ?? 5)).join('')}</select></label>
        </div>
        <label class="check"><input type="checkbox" name="thirdPlace" ${e.finals?.thirdPlace ? 'checked' : ''}> 🥉 3rd place match: the semi-final losers play for 3rd (semi-finals or quarter-finals only; same best-of as the semis)</label>
        <label class="check"><input type="checkbox" name="solos" ${e.solos ? 'checked' : ''}> Players can sign up solo (you group them into teams on the Teams tab)</label>
        <label class="check"><input type="checkbox" name="signups" ${e.signups ? 'checked' : ''}> Clubs can sign themselves up on the event page (closes 10 minutes before the start)</label>
        <label class="check"><input type="checkbox" name="showTable" ${e.showTable ? 'checked' : ''}> Show a table (wins, sets, points) on the event page</label>
        ${flowConfigHtml(e)}
        ${isTournament ? `
        <label class="field"><span>Format note (shown on the event page)</span><input type="text" name="formatNote" maxlength="120" value="${esc(e.formatNote ?? '')}" placeholder="e.g. Round robin, then a best-of-5 final"></label>
        <label class="field"><span>Prize</span><input type="text" name="prize" maxlength="120" value="${esc(e.prize ?? '')}"></label>` : ''}
        <p class="muted small">Every set is first to 10, win by 2. Knockout places go to group winners, then runners-up (best runners-up on points if not all fit), paired so group mates don’t meet in the first knockout round. Knockout matches don’t count in the tables.</p>
      </section>
      <section class="panel">
        <label class="field"><span>Sign-up link</span><input type="url" name="signupUrl" value="${esc(e.signupUrl ?? '')}" placeholder="https://"></label>
        <label class="field"><span>Stream link</span><input type="url" name="streamUrl" value="${esc(e.streamUrl ?? '')}" placeholder="https://twitch.tv/…"></label>
        <label class="field"><span>Status</span><select name="status">${Object.entries(EVENT_STATUSES).map(([k, v]) => opt(k, v, e.status)).join('')}</select></label>
        <label class="check"><input type="checkbox" name="published" ${e.published ? 'checked' : ''}> Published (visible to everyone)</label>
        <label class="check"><input type="checkbox" name="featured" ${e.featured ? 'checked' : ''}> ★ Feature this event (the "featured!" card on every page; otherwise the next event is shown)</label>
      </section>
      <div class="save-bar">
        <button type="submit" class="btn btn-primary">${page.id ? 'Save details' : 'Create event'}</button>
        ${page.id ? '<button type="button" class="btn btn-danger" data-act="delete-event">Delete event</button>' : ''}
        <a class="link-btn" href="/admin" data-link>Cancel</a>
        <p class="form-error" role="alert" hidden></p>
      </div>
    </form>`;
}

// Match night (rules/flow.js): how matches open on the night. Runs by itself; admins only step in
// for stuck matches, or to pause / open early on the Fixtures tab.
function flowConfigHtml(e) {
  const flow = { ...FLOW_DEFAULTS, ...(e.flow ?? {}) };
  const mins = (list, current, extra = '') => list.map((n) => opt(n, `${n} minutes`, current)).join('') + extra;
  return `
        <div class="flow-config">
          <h4>Match night</h4>
          <label class="check"><input type="checkbox" name="flowOn" ${flow.on !== false ? 'checked' : ''}> Run matches by themselves: reporting opens at the start time, each team’s next match opens once its last score is confirmed, then a break before the finals</label>
          <label class="check"><input type="checkbox" name="matchThreads" ${e.matchThreads !== false ? 'checked' : ''}> Discord match threads: the bot opens a thread per match where players report the score with a form (also on the 🤖 Bot page)</label>
          <label class="check"><input type="checkbox" name="readyUp" ${flow.readyUp === true ? 'checked' : ''}> Check-in: players check in once for the event (staff can check them in); a team's matches start (reporting + Discord thread) once ${Number(e.teamSize) || 4} of its players have checked in</label>
          <div class="field-row">
            <label class="field"><span>Break before the finals</span><select name="breakMinutes">${mins([5, 10, 15, 20, 30, 45, 60], flow.breakMinutes ?? '', opt('', 'Until an admin opens them', flow.breakMinutes ?? ''))}</select></label>
            <label class="field"><span>Ping admins about a stuck match after</span><select name="stuckMinutes">${mins([5, 10, 15, 20, 30], flow.stuckMinutes)}</select></label>
            <label class="field"><span>Usual match length</span><select name="matchMinutes">${mins([10, 15, 20, 25, 30, 40], flow.matchMinutes)}</select></label>
          </div>
          <p class="muted small" style="margin:0">A match is stuck when the teams’ scores don’t match, or only one team has reported, for that long; or nobody has reported a usual match length plus that long after it opened. Captains (club managers) can confirm the other team’s score with one tap. Pause, open early and open the finals on the Fixtures tab.</p>
        </div>`;
}

function readDetails(form) {
  const val = (n) => form.querySelector(`[name=${n}]`)?.value ?? '';
  const { date, timeTbd } = dateFromInputs(val('date'), val('time'));
  const type = val('type');
  return {
    type,
    title: val('title').trim(),
    summary: val('summary').trim(),
    details: val('details').trim(),
    date,
    timeTbd,
    teamSize: val('teamSize') === '' ? null : Number(val('teamSize')),
    matchFormat: { bestOf: Number(val('bestOf')) || 3 },
    formatNote: type === 'tournament' ? val('formatNote').trim() || null : null,
    prize: type === 'tournament' ? val('prize').trim() || null : null,
    showTable: form.querySelector('[name=showTable]').checked,
    autoFixtures: val('autoFixtures') || 'off',
    finals: { type: val('finalsType') || 'none', semiBestOf: Number(val('semiBestOf')) || 3, finalBestOf: Number(val('finalBestOf')) || 5, thirdPlace: form.querySelector('[name=thirdPlace]')?.checked ?? false },
    signups: form.querySelector('[name=signups]').checked,
    solos: form.querySelector('[name=solos]')?.checked ?? false,
    matchThreads: form.querySelector('[name=matchThreads]')?.checked ?? true,
    // Groups: count and how teams are drawn. Teams already placed (Teams tab, or saved at the lock) stay placed.
    groups: { count: Number(val('groupCount')) || 1, draw: val('groupDraw') || 'auto', assign: page.existing?.groups?.assign ?? {} },
    signupUrl: val('signupUrl').trim() || null,
    streamUrl: val('streamUrl').trim() || null,
    status: val('status'),
    published: form.querySelector('[name=published]').checked,
    featured: form.querySelector('[name=featured]')?.checked ?? false,
    // Keeps the live parts (paused, opened early, finals opening) as they are.
    flow: {
      ...(page.existing?.flow ?? {}),
      on: form.querySelector('[name=flowOn]')?.checked ?? true,
      readyUp: form.querySelector('[name=readyUp]')?.checked ?? false,
      breakMinutes: val('breakMinutes') === '' ? null : Number(val('breakMinutes')),
      stuckMinutes: Number(val('stuckMinutes')) || FLOW_DEFAULTS.stuckMinutes,
      matchMinutes: Number(val('matchMinutes')) || FLOW_DEFAULTS.matchMinutes,
    },
  };
}

// ---------- Teams tab ----------

// Solo sign-ups: players who signed up on their own, and the mix teams made from them.
function solosPanel() {
  const { b, people } = page;
  const e = b.event;
  if (!e.solos && !(b.solos ?? []).length) return '';
  const mixTeams = (e.teamIds ?? []).map((id) => people.teams.find((t) => t.id === id)).filter((t) => t?.mix);
  const placed = new Set(mixTeams.flatMap((t) => b.rosters[t.id]?.playerIds ?? []));
  const waiting = (b.solos ?? []).filter((s) => !placed.has(s.playerId))
    .sort((x, y) => (x.createdAt ?? 0) - (y.createdAt ?? 0));
  const name = (pid) => esc(people.players.find((p) => p.id === pid)?.displayName ?? pid);
  const size = e.teamSize ?? 4;
  return `
    <section class="panel" data-solos>
      <div class="section-head"><h3>Solo players</h3><span class="muted small">${(b.solos ?? []).length} signed up · ${waiting.length} waiting for a team</span></div>
      ${waiting.length ? `
        <p class="muted small" style="margin-top:0">Tick players and name a team, or let the site split everyone waiting into teams of ${size}.</p>
        <div class="tick-list">${waiting.map((s) => {
          const p = people.players.find((x) => x.id === s.playerId);
          const club = p?.teamId ? people.teams.find((t) => t.id === p.teamId)?.name : null;
          return `<label class="check"><input type="checkbox" name="solo" value="${esc(s.playerId)}"> ${name(s.playerId)}${club ? ` <span class="muted small">(${esc(club)})</span>` : ''}</label>`;
        }).join('')}</div>
        <div class="field-row" style="margin-top:10px;align-items:end">
          <label class="field" style="margin:0"><span>Team name</span><input type="text" name="mixName" maxlength="40" placeholder="Mix ${mixTeams.length + 1}"></label>
          <button type="button" class="btn btn-primary btn-sm" data-act="make-mix">Make team from ticked</button>
          <button type="button" class="btn btn-sm" data-act="auto-mix">Auto-group everyone (${size} a team)</button>
        </div>` : '<p class="muted small" style="margin-top:0">Nobody waiting. Solo players appear here when they sign up on the event page.</p>'}
      ${mixTeams.length ? `
        <div class="section-head" style="margin-top:14px"><h3>Mix teams</h3></div>
        <div class="rows">${mixTeams.map((t) => `
          <div class="row"><span class="row-main"><b><span class="team">${teamDot(t)}${esc(t.name)}</span></b>
            <span class="muted small">${(b.rosters[t.id]?.playerIds ?? []).map(name).join(', ') || 'No players'}</span></span>
            <span class="row-side"><button type="button" class="btn btn-sm btn-danger" data-act="break-mix" data-id="${esc(t.id)}">Break up</button></span></div>`).join('')}</div>` : ''}
      <p class="form-error" role="alert" hidden></p>
    </section>`;
}

// Groups: which group each team is in. "Auto" = drawn automatically; or pick a group by hand.
function groupsPanel() {
  const { b, people } = page;
  const e = b.event;
  const n = groupCount(e);
  if (n < 2) return '';
  const letters = LETTERS.slice(0, n).split('');
  const assign = e.groups?.assign ?? {};
  const locked = Boolean(e.fixturesLockedAt);
  const teams = b.plan.teamIds.map((id) => people.teams.find((t) => t.id === id) ?? { id, name: id });
  return `
    <section class="panel" data-groups>
      <div class="section-head"><h3>Groups</h3><span class="muted small">${n} groups · ${esc(e.groups?.draw === 'manual' ? 'placed by hand, the rest drawn' : 'automatic draw')}</span></div>
      ${locked ? '<p class="small"><b>The fixtures are locked, so the groups are fixed.</b> Clear the fixtures (Fixtures tab) to change them.</p>' : '<p class="muted small" style="margin-top:0">Pick a group to place a team by hand. “Auto” teams are drawn into the smallest groups. The draw is saved when the fixtures lock.</p>'}
      ${teams.length ? `<div class="group-columns">${letters.map((l) => `
        <div class="group-col"><b>Group ${l}</b> <span class="muted small">${b.plan.groups[l].length} teams</span>
          <ul>${b.plan.groups[l].map((id) => {
            const t = teams.find((x) => x.id === id);
            return `<li><span class="team">${teamDot(t)}${esc(t?.name ?? id)}</span>
              <select data-group-team="${esc(id)}" aria-label="Group for ${esc(t?.name ?? id)}" ${locked ? 'disabled' : ''}>
                ${opt('', 'Auto', assign[id] && letters.includes(assign[id]) ? '-' : '')}${letters.map((x) => opt(x, x, assign[id] ?? '')).join('')}
              </select></li>`;
          }).join('')}</ul>
        </div>`).join('')}</div>` : '<p class="muted">No teams yet.</p>'}
      ${locked || !teams.length ? '' : `<div class="actions">
        <button type="button" class="btn btn-primary btn-sm" data-act="save-groups">Save groups</button>
        <button type="button" class="btn btn-sm" data-act="redraw-groups">Re-draw everyone automatically</button>
      </div>`}
      <p class="muted small" style="margin-bottom:0">Current draw: ${letters.map((l) => `${l} ${b.plan.groups[l].length}`).join(' · ')}</p>
    </section>`;
}

function teamsHtml() {
  const { b, people } = page;
  const inEvent = new Set(b.event.teamIds ?? []);
  // Only approved teams can enter events (or ones already in this event).
  const teams = [...people.teams]
    .filter((t) => (t.status ?? 'approved') === 'approved' || inEvent.has(t.id))
    .sort((x, y) => x.name.localeCompare(y.name));
  const players = [...people.players].sort((x, y) => x.displayName.localeCompare(y.displayName));
  const rosterOf = (teamId) => new Set(b.rosters[teamId]?.playerIds ?? []);

  const signedUp = new Map(b.entries.map((x) => [x.teamId, x]));
  const rosterPanels = teams.filter((t) => inEvent.has(t.id) || signedUp.has(t.id)).map((t) => {
    const roster = rosterOf(t.id);
    const squad = players.filter((p) => p.teamId === t.id);
    // Squad members first, then everyone else.
    const ordered = [...squad, ...players.filter((p) => p.teamId !== t.id)];
    return `
      <section class="panel" data-roster="${esc(t.id)}">
        <div class="section-head"><h3><span class="team">${teamDot(t)}${esc(t.name)}</span></h3><span class="muted small">${roster.size} player${roster.size === 1 ? '' : 's'}</span></div>
        ${squad.length ? `<button type="button" class="link-btn" data-act="tick-squad" data-team="${esc(t.id)}" data-ids="${esc(squad.map((p) => p.id).join(','))}">Tick the current squad (${squad.length})</button>` : ''}
        <div class="tick-list">${ordered.map((p) => `<label class="check"><input type="checkbox" value="${esc(p.id)}" ${roster.has(p.id) ? 'checked' : ''}> ${esc(p.displayName)}${p.teamId === t.id ? ' <span class="muted small">squad</span>' : ''}</label>`).join('')}</div>
        <button type="button" class="btn btn-sm" data-act="save-roster" data-team="${esc(t.id)}" style="margin-top:10px">Save ${esc(t.shortName ?? t.name)} roster</button>
      </section>`;
  }).join('');

  return `
    <div class="stack">
      ${signedUp.size ? `<section class="panel flush rows">
        <div class="section-head" style="padding:12px 16px 0"><h3>Signed up by their managers</h3></div>
        ${[...signedUp.values()].map((x) => {
          const t = people.teams.find((tt) => tt.id === x.teamId);
          return `<div class="row"><span class="row-main"><b><span class="team">${teamDot(t)}${esc(t?.name ?? x.teamId)}</span></b><span class="muted small">${x.createdAt ? `${fmtDay(x.createdAt)} ${fmtTime(x.createdAt)}` : ''}</span></span>
            <span class="row-side"><button type="button" class="btn btn-sm btn-danger" data-act="remove-entry" data-id="${esc(x.id)}">Remove</button></span></div>`;
        }).join('')}
      </section>` : ''}
      ${solosPanel()}
      ${groupsPanel()}
      <section class="panel" data-teams>
        <div class="section-head"><h3>Teams added by admins</h3><a href="/admin/people" data-link>Add teams &amp; players</a></div>
        ${teams.length ? `<div class="tick-list">${teams.map((t) => `<label class="check"><input type="checkbox" value="${esc(t.id)}" ${inEvent.has(t.id) ? 'checked' : ''}> ${teamDot(t)} ${esc(t.name)}</label>`).join('')}</div>
        <button type="button" class="btn btn-primary btn-sm" data-act="save-teams" style="margin-top:10px">Save teams</button>`
        : '<p class="muted">No teams yet. Add some under Teams &amp; players first.</p>'}
      </section>
      ${rosterPanels ? `<div class="section-head"><h2>Rosters</h2></div>${rosterPanels}` : ''}
      <p class="form-error" role="alert" hidden></p>
    </div>`;
}

// ---------- Fixtures tab ----------

function fixtureForm(f) {
  const { b, people } = page;
  const pool = b.teams.length ? b.teams : people.teams;
  const teamOptions = (current) => `<option value="">Choose team…</option>${[...pool].sort((x, y) => x.name.localeCompare(y.name)).map((t) => opt(t.id, t.name, current)).join('')}`;
  const { dateStr, timeStr } = inputsFromDate(f?.scheduledAt ?? null, f?.timeTbd ?? !f?.scheduledAt);
  return `
    <form class="inline-form" data-form="fixture" data-id="${esc(f?.id ?? '')}" novalidate>
      <div class="field-row">
        <label class="field"><span>Round</span><select name="prefix" data-fixture-id="${esc(f?.id ?? '')}">
          <option value="">Pick a round (fills in the label)…</option>
          ${Object.values(ELIM_PREFIXES).map((g) => `<optgroup label="${esc(g.label)}">${g.rounds.map((r) => opt(r, r, elimRound(f?.label))).join('')}</optgroup>`).join('')}
        </select></label>
        <label class="field"><span>Label (optional)</span><input type="text" name="label" maxlength="60" value="${esc(f?.label ?? '')}" placeholder="e.g. Upper Round 1 · Match 2, Semi-final, Showmatch"></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Home</span><select name="home">${teamOptions(f?.homeTeamId)}</select></label>
        <label class="field"><span>Away</span><select name="away">${teamOptions(f?.awayTeamId)}</select></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Date (empty = TBD)</span><input type="date" name="date" value="${esc(dateStr)}"></label>
        <label class="field"><span>Time (empty = TBD)</span><input type="time" name="time" value="${esc(timeStr)}"></label>
      </div>
      <label class="field"><span>Best of</span><select name="bestOf">${opt('', `Event default (${b.season.format.bestOf})`, f?.bestOf ?? '')}${opt(3, '3', f?.bestOf)}${opt(5, '5', f?.bestOf)}</select></label>
      <div class="actions">
        <button type="submit" class="btn btn-primary btn-sm">${f ? 'Save fixture' : 'Add fixture'}</button>
        <a class="link-btn" href="${urls.adminEvent(b.event.id, 'fixtures')}" data-link data-keep-scroll>Cancel</a>
      </div>
      <p class="form-error" role="alert" hidden></p>
    </form>`;
}

// Match night controls (rules/flow.js): where the event is, stuck matches, pause / open early.
const STUCK_WHY = { disputed: 'the teams’ scores don’t match', waiting: 'only one team has reported', 'no-votes': 'nobody has reported yet' };
function flowControlsHtml() {
  const b = page.b;
  const e = b.event;
  if (!flowOf(e)) return `<section class="panel"><div class="section-head"><h3>Match night</h3><a href="${urls.adminEvent(e.id, 'details')}" data-link>Rule config</a></div><p class="small" style="margin:0">Off: every saved match takes results at any time. Switch it on in Rule config.</p></section>`;
  const now = Date.now();
  const p = eventPhase(b, now);
  const live = liveSummary(b, now);
  const at = (ms) => `${fmtDay(ms)} ${fmtTime(ms)} ${zoneLabel(ms)}`;
  const line = {
    before: p.startsAt ? `Reporting opens at the start: <b>${esc(at(p.startsAt))}</b>.` : 'Waiting for the start.',
    paused: '<b>⏸ Paused.</b> No match takes results until you resume.',
    groups: `<b><span class="live-dot"></span> Live: group stage.</b> ${live?.open.length ?? 0} on now, ${live?.left ?? 0} to play.`,
    break: p.breakEndsAt ? `<b>☕ Break.</b> Finals open by themselves at ${esc(fmtTime(p.breakEndsAt))} ${esc(zoneLabel(p.breakEndsAt))}.` : '<b>☕ Break.</b> The finals wait for you: press Open finals now.',
    finals: `<b><span class="live-dot"></span> Live: finals.</b> ${live?.open.length ?? 0} on now.`,
    done: 'Finished: every match has a score.',
  }[p.phase] ?? '';
  const stuck = live?.stuck ?? [];
  const name = (id) => esc(b.teamsById[id]?.name ?? 'TBC');
  const btn = (act, label, cls = 'btn') => `<button class="btn-sm ${cls}" type="button" data-act="${act}">${label}</button>`;
  return `
    <section class="panel flow-panel">
      <div class="section-head"><h3>Match night</h3><a href="${urls.adminEvent(e.id, 'details')}" data-link>Change in Rule config</a></div>
      <p class="small" style="margin-top:0">${line}</p>
      ${stuck.length ? `<div class="flow-stuck"><b>⚠ Needs you</b>${stuck.map(({ f, why }) => `<a class="row" href="${urls.adminResult(e.id, f.id)}" data-link><span class="row-main">${name(f.homeTeamId)} v ${name(f.awayTeamId)}<span class="muted small">${esc(STUCK_WHY[why] ?? why)}</span></span><span class="row-side">Enter result →</span></a>`).join('')}</div>` : ''}
      <div class="actions">
        ${p.phase === 'before' ? btn('flow-open-now', 'Open matches now', 'btn btn-primary') : ''}
        ${['groups', 'break', 'finals'].includes(p.phase) ? btn('flow-pause', '⏸ Pause') : ''}
        ${p.phase === 'paused' ? btn('flow-resume', '▶ Resume', 'btn btn-primary') : ''}
        ${p.phase === 'break' ? btn('flow-open-finals', 'Open finals now', 'btn btn-primary') : ''}
      </div>
    </section>`;
}

// Sign-ups, self-adjusting fixtures and finals (rules/autofix.js).
function scheduleSettingsHtml() {
  const e = page.b.event;
  const finals = e.finals ?? {};
  const closes = lockTime(e);
  const locked = isLocked(e);
  let lockLine;
  if (e.fixturesLockedAt) lockLine = `Fixtures locked ${fmtDay(e.fixturesLockedAt)} ${fmtTime(e.fixturesLockedAt)}.`;
  else if (locked) lockLine = 'Locked: the fixtures are being saved.';
  else if (closes) lockLine = `Sign-ups close and the fixtures lock at ${fmtDay(closes)} ${fmtTime(closes)} (10 minutes before the start).`;
  else lockLine = 'This event has no start time, so it won’t lock by itself. Set a date and time on Details, or lock it yourself.';
  const auto = e.autoFixtures && e.autoFixtures !== 'off';
  const rules = [
    groupCount(e) > 1 ? `${groupCount(e)} groups` : 'No groups',
    AUTO_MODES[e.autoFixtures ?? 'off'],
    FINALS_TYPES[finals.type ?? 'none'],
    e.signups ? 'clubs sign themselves up' : 'admins add teams',
  ].join(' · ');
  return `
    <section class="panel">
      <div class="section-head"><h3>Automatic fixtures</h3><a href="${urls.adminEvent(e.id, 'details')}" data-link>Change in Rule config</a></div>
      <p class="small" style="margin-top:0">${esc(rules)}</p>
      ${(() => { const n = page.b.plan.teamIds.length; const s = suggestSetup(n); return n >= 6 && s.groups !== groupCount(e) ? `<p class="small">💡 For ${n} teams we suggest ${s.groups === 1 ? 'no groups' : `${s.groups} groups`} (${esc(suggestionText(n))}). <a href="${urls.adminEvent(e.id, 'details')}" data-link>Change in Rule config</a></p>` : ''; })()}
      <p class="small">${auto ? '<span class="live-dot" aria-hidden="true"></span> Updates live as clubs join or leave. ' : ''}<b>${esc(lockLine)}</b> ${page.b.plan.teamIds.length} team${page.b.plan.teamIds.length === 1 ? '' : 's'} in.</p>
      ${['semis', 'quarters'].includes(finals.type) && !finals.thirdPlace ? `<p class="small">🥉 No 3rd place match yet. <button class="btn btn-sm btn-primary" type="button" data-act="add-third">Add 3rd place match</button> (the two semi-final losers; it's saved as soon as both semis have a score, so you can enter its score and stats).</p>` : ''}
      <div class="actions">
        ${!e.fixturesLockedAt && auto ? '<button class="btn btn-sm" type="button" data-act="lock-now">Lock fixtures now</button>' : ''}
        <button class="btn btn-sm btn-danger" type="button" data-act="clear-fixtures">Clear fixtures</button>
      </div>
      <p class="muted small" style="margin-bottom:0">Clear fixtures deletes every fixture without a result (results are kept) and unlocks the schedule, so the automatic fixtures build again from the current teams.</p>
      <p class="form-error" role="alert" hidden></p>
    </section>`;
}

function fixturesHtml(editId) {
  const { b } = page;
  const list = [...b.fixtures].sort(stageOrder);
  // A heading whenever the section changes: each group, other matches, the knockout.
  const sectionOf = (f) => (f.stage === 'playoffs' ? 'Knockout' : f.group ? `Group ${f.group}` : (b.plan.groupCount > 1 ? 'Other matches' : ''));
  let lastSection = null;
  const rows = list.map((f) => {
    const section = sectionOf(f);
    const head = section && section !== lastSection ? `<div class="day-head admin-section-head">${esc(section)}</div>` : '';
    lastSection = section;
    return head + fixtureAdminRow(f);
  }).join('');
  function fixtureAdminRow(f) {
    const home = b.teamsById[f.homeTeamId];
    const away = b.teamsById[f.awayTeamId];
    const { result, check } = resultOf(b, f);
    const when = f.scheduledAt ? `${fmtDay(f.scheduledAt)} ${f.timeTbd ? '· Time TBD' : fmtTime(f.scheduledAt)}` : 'Date TBD';
    const status = check?.ok ? `<span class="tag tag-live">${check.homeSets}–${check.awaySets}</span>` : result ? '<span class="tag tag-draft">Check result</span>' : '';
    const draft = f.virtual ? `<span class="tag tag-draft">${f.auto ? 'Draft: saves at the lock' : 'Waiting for teams'}</span>` : '';
    return `
      <div class="row">
        <span class="row-main">
          <b><span class="team">${teamDot(home)}${esc(home?.name ?? f.homePlaceholder ?? 'TBC')}</span> v <span class="team">${esc(away?.name ?? f.awayPlaceholder ?? 'TBC')}${teamDot(away)}</span></b>
          <span class="muted small">${[f.label, when, f.bestOf ? `Best of ${f.bestOf}` : ''].filter(Boolean).map(esc).join(' · ')}</span>
        </span>
        <span class="row-side">
          ${status}${draft}
          ${f.virtual ? '' : `
          <a class="btn btn-sm btn-primary" href="${urls.adminResult(b.event.id, f.id)}" data-link>${result ? 'Edit result' : 'Result'}</a>
          <a class="btn btn-sm" href="${urls.adminEvent(b.event.id, 'fixtures')}&edit=${encodeURIComponent(f.id)}" data-link data-keep-scroll>Edit</a>
          <button type="button" class="btn btn-sm btn-danger" data-act="delete-fixture" data-id="${esc(f.id)}">Delete</button>`}
        </span>
      </div>
      ${editId === f.id ? fixtureForm(f) : ''}`;
  }

  return `
    <div class="stack">
      ${flowControlsHtml()}
      ${scheduleSettingsHtml()}
      ${b.plan.finalsNote ? `<p class="muted small">${esc(b.plan.finalsNote)}</p>` : ''}
      <div class="event-links">
        <a class="btn btn-primary" href="${urls.adminEvent(b.event.id, 'fixtures')}&edit=new" data-link data-keep-scroll>+ Add fixture</a>
      </div>
      ${elimBoxHtml()}
      ${editId === 'new' ? `<section class="panel flush">${fixtureForm(null)}</section>` : ''}
      <section class="panel flush rows">${rows || '<p class="muted" style="padding:16px">No fixtures yet.</p>'}</section>
      <p class="muted small">Times are entered in your own time zone; visitors see them in theirs.</p>
      <p class="form-error" role="alert" hidden></p>
    </div>`;
}

// Elimination bracket helper (rules/elim-fill.js): fills in the rest of the current round from the
// matches already made, and the next round once a round has all its scores.
function elimOutcome(b) {
  return (f) => {
    const { check } = resultOf(b, f);
    if (!check?.ok) return null;
    const home = check.winner === 'home';
    return { winner: home ? f.homeTeamId : f.awayTeamId, loser: home ? f.awayTeamId : f.homeTeamId };
  };
}
const elimArgs = (b, kind) => ({ kind, fixtures: b.fixtures.filter((f) => !f.virtual), teamIds: b.teams.map((t) => t.id), outcome: elimOutcome(b), seed: b.event.id, byes: b.event.elimByes ?? {} });

function elimBoxHtml() {
  const { b } = page;
  if (b.event.autoFixtures && b.event.autoFixtures !== 'off') return '';
  const double = b.fixtures.some((f) => /^(Upper|Lower) |^Grand Final/.test(f.label ?? ''));
  // Teams waiting for a match in the current round: tick the ones that get a bye.
  const waiting = b.teams.length >= 2 ? pendingRound(elimArgs(b, double ? 'double' : 'single')) : null;
  const saved = Object.entries(b.event.elimByes ?? {}).filter(([, ids]) => ids?.length);
  return `
    <section class="panel elim-box">
      <div class="bot-action">
        <b>🪄 Elimination bracket</b>
        <select data-elim-kind aria-label="Bracket type">
          <option value="single"${double ? '' : ' selected'}>Single elimination</option>
          <option value="double"${double ? ' selected' : ''}>Double elimination</option>
        </select>
        <button class="btn btn-primary btn-sm" type="button" data-act="elim-fill">Fill in the next matches</button>
      </div>
      ${waiting?.free.length ? `<div class="elim-byes small"><b>Not in a match yet (${esc(waiting.round)}):</b> tick any that get a bye
        ${waiting.free.map((id) => `<label class="check"><input type="checkbox" data-elim-bye value="${esc(id)}"> ${esc(b.teamsById[id]?.name ?? id)}</label>`).join('')}</div>` : ''}
      ${saved.length ? `<p class="small" style="margin:6px 0 0">Byes so far: ${saved.map(([r, ids]) => `${esc(r)}: ${ids.map((id) => esc(b.teamsById[id]?.name ?? id)).join(', ')}`).join(' · ')}</p>` : ''}
      <p class="muted small" style="margin:6px 0 0">Keeps every match already made, and your numbering. Pairs up the teams not yet in the current round, apart from the ones you tick for a bye (an odd one out gets a bye too), and once a round has all its scores, makes the next round from the winners and the byes. Double elimination also drops losers into the lower bracket, then makes the Grand Final. Shows you the list before saving. Press it again after each round.</p>
    </section>`;
}

// ---------- Page ----------

export async function render({ eventId }) {
  const gate = await adminGate();
  if (gate.html) return { title: 'Admin sign-in', html: `<div class="admin-root">${gate.html}</div>` };

  const params = new URLSearchParams(location.search);
  const isNew = eventId === 'new';
  let b = null;
  if (!isNew) {
    await syncSchedules({ force: true }).catch(() => 0); // save a locked schedule / ready finals first
    b = await loadEventBundle(eventId, { fresh: true, admin: true });
  }
  if (!isNew && !b) throw new NotFoundError('That event doesn’t exist');
  const people = await loadPeople({ fresh: true, admin: true });
  const askedType = params.get('type');
  const draft = b?.event ?? { type: EVENT_TYPES[askedType] ? askedType : 'exhibition', status: 'upcoming', published: false, date: null, timeTbd: true, teamSize: 4, teamIds: [], autoFixtures: 'once', signups: true, finals: { type: 'none', semiBestOf: 3, finalBestOf: 5 }, flow: { readyUp: true } };
  const tab = isNew ? 'details' : ['teams', 'fixtures'].includes(params.get('tab')) ? params.get('tab') : 'details';
  page = { id: isNew ? null : eventId, existing: b?.event ?? null, b, people, user: gate.user, tab };

  const tabs = isNew ? '' : `<nav class="chips">${[['details', 'Details'], ['teams', 'Teams & rosters'], ['fixtures', 'Fixtures & results']]
    .map(([t, label]) => `<a class="chip-link" href="${urls.adminEvent(eventId, t)}" data-link${t === tab ? ' aria-current="true"' : ''}>${label}</a>`).join('')}</nav>`;
  const body = tab === 'teams' ? teamsHtml() : tab === 'fixtures' ? fixturesHtml(params.get('edit')) : detailsHtml(draft);
  const heading = isNew ? `New ${EVENT_TYPES[draft.type].label.toLowerCase()}` : draft.title;

  return {
    title: heading,
    html: `
      <div class="admin-root">
        ${adminBar(gate.user, gate.admin, '/admin')}
        <div class="page-head"><div><h1>${esc(heading)}</h1>${b ? `<p class="muted">${b.event.published ? `Published · <a href="${urls.event(eventId)}" data-link>view public page</a>` : 'Draft: only admins can see it'}</p>` : ''}</div></div>
        ${tabs}
        <div class="entry">${body}</div>
      </div>`,
  };
}

function showError(root, message) {
  const el = root.querySelector('.form-error');
  if (el) {
    el.textContent = message;
    el.hidden = false;
  }
}

const failMessage = (err) => (err.code === 'permission-denied' ? 'Not allowed to save. Are you still on the admin list?' : 'Couldn’t save. Check your connection and try again.');

export function mount(el) {
  const root = el.querySelector('.admin-root');
  if (!root) return;
  bindAuthActions(root);
  if (!root.querySelector('.entry')) return;
  const uid = page.user.uid;

  root.addEventListener('input', (e) => {
    if (e.target.matches('[data-form="details"] [name=date], [data-form="details"] [name=time]')) {
      const form = e.target.form;
      root.querySelector('.date-preview').textContent = eventDateLabel(readDetails(form));
    }
  });

  root.addEventListener('change', (e) => {
    // Fixture form: picking a round (single / double elimination) fills in the label, numbered
    // after the matches already in that round ("Upper Round 1 · Match 3").
    if (e.target.matches('[data-form="fixture"] [name=prefix]') && e.target.value) {
      const label = e.target.form.querySelector('[name=label]');
      label.value = nextLabel(e.target.value, page.b.fixtures.filter((x) => !x.virtual), e.target.dataset.fixtureId || null);
      return;
    }
    // Switching type redraws the details form (tournaments have extra fields).
    // Group / fixture choices: update the "how many matches" hint straight away.
    if (e.target.matches('[data-form="details"] [name=groupCount], [data-form="details"] [name=autoFixtures]')) {
      const hint = root.querySelector('.group-hint');
      if (hint) hint.textContent = groupHint({ ...payload(), ...readDetails(e.target.form) });
    }
    if (e.target.matches('[data-form="details"] [name=type]')) {
      root.querySelector('.entry').innerHTML = detailsHtml({ ...payload(), ...readDetails(e.target.form) });
    }
  });

  root.addEventListener('submit', async (e) => {
    const form = e.target;
    e.preventDefault();

    if (form.dataset.form === 'details') {
      const event = { ...payload(), ...readDetails(form) };
      const problems = validateEvent(event);
      if (problems.length) return showError(root, `Can’t save yet: ${problems[0]}`);
      form.querySelector('[type=submit]').disabled = true;
      try {
        const id = await saveEvent({ id: page.id, uid, event, existing: page.existing });
        navigate(urls.adminEvent(id, page.id ? 'details' : 'teams'), { replace: true });
      } catch (err) {
        console.error(err);
        form.querySelector('[type=submit]').disabled = false;
        showError(root, failMessage(err));
      }
    }

    if (form.dataset.form === 'fixture') {
      const val = (n) => form.querySelector(`[name=${n}]`).value;
      const home = val('home');
      const away = val('away');
      if (!home || !away) return showError(form, 'Pick both teams.');
      if (home === away) return showError(form, 'A team can’t play itself.');
      const { date, timeTbd } = dateFromInputs(val('date'), val('time'));
      const existing = page.b.fixtures.find((f) => f.id === form.dataset.id) ?? null;
      const order = existing?.order ?? Math.max(0, ...page.b.fixtures.map((f) => f.order ?? 0)) + 1;
      const { id: _id, round: _round, ...keep } = existing ?? {};
      const fixture = {
        ...keep,
        label: val('label').trim() || null,
        homeTeamId: home,
        awayTeamId: away,
        scheduledAt: date,
        timeTbd,
        bestOf: val('bestOf') ? Number(val('bestOf')) : null,
        order,
        status: existing?.status ?? 'scheduled',
      };
      form.querySelector('[type=submit]').disabled = true;
      try {
        await saveFixture({ eventId: page.id, id: existing?.id ?? null, uid, fixture, existing });
        navigate(urls.adminEvent(page.id, 'fixtures'), { replace: true, keepScroll: true });
      } catch (err) {
        console.error(err);
        form.querySelector('[type=submit]').disabled = false;
        showError(form, failMessage(err));
      }
    }
  });

  root.addEventListener('click', async (e) => {
    const button = e.target.closest('[data-act]');
    if (!button) return;
    const act = button.dataset.act;

    if (act === 'elim-fill') {
      const { b } = page;
      const kind = root.querySelector('[data-elim-kind]')?.value ?? 'single';
      const saved = b.fixtures.filter((f) => !f.virtual);
      if (b.teams.length < 2) { window.alert('This event needs at least 2 teams first (Teams tab, or club sign-ups).'); return; }
      const giveByes = [...root.querySelectorAll('[data-elim-bye]:checked')].map((i) => i.value);
      const plan = fillElimination({ ...elimArgs(b, kind), giveByes });
      const name = (id) => b.teamsById[id]?.name ?? id;
      if (plan.problem) { window.alert(plan.problem); return; }
      const byesChanged = JSON.stringify(plan.byes) !== JSON.stringify(b.event.elimByes ?? {});
      const newByes = Object.entries(plan.byes).flatMap(([r, ids]) => ids.filter((id) => !(b.event.elimByes?.[r] ?? []).includes(id)).map((id) => `Bye (${r}): ${name(id)}`));
      if (!plan.add.length && !byesChanged) {
        window.alert(plan.done ? 'The bracket is finished: there’s a champion.' : 'Nothing to add yet: the current round still has matches without a score. Press it again once they’re in.');
        return;
      }
      const lines = [
        ...plan.add.map((m) => `+ Match ${m.label}: ${name(m.homeTeamId)} v ${name(m.awayTeamId)}`),
        ...newByes,
      ];
      if (!window.confirm(`Add these?\n\n${lines.join('\n')}`)) return;
      button.disabled = true;
      try {
        if (byesChanged) await saveElimByes({ uid, event: b.event, byes: plan.byes });
        let order = Math.max(0, ...saved.map((f) => f.order ?? 0));
        for (const m of plan.add) {
          await saveFixture({ eventId: page.id, id: null, uid, fixture: { label: m.label, homeTeamId: m.homeTeamId, awayTeamId: m.awayTeamId, scheduledAt: null, timeTbd: true, bestOf: null, order: ++order, status: 'scheduled' }, existing: null });
        }
        refresh();
      } catch (err) {
        console.error(err);
        button.disabled = false;
        window.alert(`That didn’t save: ${err.message}`);
      }
      return;
    }

    if (act === 'tick-squad') {
      const ids = new Set(button.dataset.ids.split(','));
      root.querySelectorAll(`[data-roster="${CSS.escape(button.dataset.team)}"] .tick-list input`).forEach((i) => { i.checked = ids.has(i.value); });
      return;
    }

    if (act === 'use-suggestion') {
      const form = button.closest('form');
      form.querySelector('[name=groupCount]').value = button.dataset.groups;
      form.querySelector('[name=finalsType]').value = button.dataset.knockout;
      const hint = root.querySelector('.group-hint');
      if (hint) hint.textContent = groupHint({ ...payload(), ...readDetails(form) });
      button.outerHTML = '<p class="small" style="margin:4px 0 0">✓ Filled in. Press <b>Save details</b> to keep it.</p>';
      return;
    }

    if (act === 'clear-date') {
      root.querySelector('[name=date]').value = '';
      root.querySelector('[name=time]').value = '';
      root.querySelector('.date-preview').textContent = 'Date TBD';
      return;
    }

    try {
      if (act === 'delete-event') {
        if (!window.confirm('Delete this event, with all its fixtures and results? This can’t be undone.')) return;
        button.disabled = true;
        await deleteEvent({ uid, bundle: page.b });
        navigate('/admin', { replace: true });
      }

      if (act === 'save-teams') {
        const teamIds = [...root.querySelectorAll('[data-teams] input:checked')].map((i) => i.value);
        button.disabled = true;
        await saveEvent({ id: page.id, uid, event: payload({ teamIds }), existing: page.existing });
        refresh();
      }

      if (act === 'save-roster') {
        const teamId = button.dataset.team;
        const playerIds = [...root.querySelectorAll(`[data-roster="${CSS.escape(teamId)}"] input:checked`)].map((i) => i.value);
        const existing = page.b.rosters[teamId] ?? null;
        button.disabled = true;
        await saveRoster({ eventId: page.id, teamId, uid, roster: { playerIds, captainId: existing?.captainId ?? null }, existing });
        refresh();
      }

      if (act === 'delete-fixture') {
        const fixture = page.b.fixtures.find((f) => f.id === button.dataset.id);
        const result = page.b.results[fixture.id] ?? null;
        if (!window.confirm(result ? 'Delete this fixture and its result?' : 'Delete this fixture?')) return;
        button.disabled = true;
        await deleteFixture({ eventId: page.id, uid, fixture, result });
        refresh();
      }

      if (act === 'add-third') {
        button.disabled = true;
        const ev = page.b.event;
        await saveEvent({ id: page.id, uid, event: payload({ finals: { ...(ev.finals ?? {}), thirdPlace: true } }), existing: page.existing });
        await syncSchedules({ force: true }).catch(() => 0); // saves finals-3rd now if both semis are played
        refresh();
      }

      if (act.startsWith('flow-')) {
        const changes = { 'flow-open-now': { openAt: Date.now() }, 'flow-pause': { paused: true }, 'flow-resume': { paused: false }, 'flow-open-finals': { finalsOpenAt: Date.now() } }[act];
        if (!changes) return;
        if (act === 'flow-open-now' && !window.confirm('Open every team’s first match for reporting now, before the start time?')) return;
        button.disabled = true;
        await saveFlow({ eventId: page.id, uid, event: page.b.event, changes });
        if (act === 'flow-open-finals') await syncSchedules({ force: true }).catch(() => 0);
        refresh();
      }

      if (act === 'lock-now') {
        if (!window.confirm('Lock the fixtures now? Sign-ups close and the round robin stops changing.')) return;
        button.disabled = true;
        const b = page.b;
        // Work the plan out as if the lock time had passed, then save it.
        const plan = schedulePlan({
          event: { ...b.event, status: 'upcoming', date: b.event.date ?? Date.now(), timeTbd: false, fixturesLockedAt: null },
          season: b.season,
          entries: b.entries,
          fixtures: b.fixtures.filter((f) => !f.virtual),
          results: b.results,
          now: Infinity,
        });
        await saveSchedule({ eventId: page.id, uid, fixtures: plan.toSave, lockGroup: true, event: b.event, draw: drawToSave(plan) });
        refresh();
      }

      if (act === 'make-mix' || act === 'auto-mix') {
        const b = page.b;
        const ticked = [...root.querySelectorAll('[data-solos] [name=solo]:checked')].map((i) => i.value);
        const all = [...root.querySelectorAll('[data-solos] [name=solo]')].map((i) => i.value);
        const mixCount = (b.event.teamIds ?? []).filter((id) => page.people.teams.find((t) => t.id === id)?.mix).length;
        let groups;
        if (act === 'make-mix') {
          if (ticked.length < 1) return showError(root.querySelector('[data-solos]'), 'Tick the players for this team first.');
          groups = [{ name: root.querySelector('[name=mixName]').value.trim() || `Mix ${mixCount + 1}`, playerIds: ticked }];
        } else {
          const size = b.event.teamSize ?? 4;
          // Shuffle, then deal into teams of the event's team size (the last team takes any leftovers).
          const pool = [...all].sort(() => Math.random() - 0.5);
          const count = Math.max(1, Math.floor(pool.length / size));
          groups = Array.from({ length: count }, (_, i) => ({ name: `Mix ${mixCount + i + 1}`, playerIds: [] }));
          pool.forEach((pid, i) => groups[Math.min(Math.floor(i / size), count - 1)].playerIds.push(pid));
          if (!window.confirm(`Make ${count} team${count === 1 ? '' : 's'} from ${pool.length} solo player${pool.length === 1 ? '' : 's'}?`)) return;
        }
        button.disabled = true;
        await makeMixTeams({ uid, event: b.event, groups, takenIds: page.people.teams.map((t) => t.id) });
        refresh();
      }

      if (act === 'break-mix') {
        const team = page.people.teams.find((t) => t.id === button.dataset.id);
        if (!team || !window.confirm(`Break up ${team.name}? Its players go back to the solo list.`)) return;
        button.disabled = true;
        await breakUpMixTeam({ uid, event: page.b.event, team, roster: page.b.rosters[team.id] ?? null });
        refresh();
      }

      if (act === 'save-groups' || act === 'redraw-groups') {
        const assign = {};
        if (act === 'save-groups') {
          for (const sel of root.querySelectorAll('[data-group-team]')) if (sel.value) assign[sel.dataset.groupTeam] = sel.value;
        } else if (!window.confirm('Clear every hand-placed team and draw all groups automatically?')) return;
        button.disabled = true;
        await saveEvent({ id: page.id, uid, event: payload({ groups: { ...(page.existing.groups ?? {}), assign } }), existing: page.existing });
        refresh();
      }

      if (act === 'remove-entry') {
        const entry = page.b.entries.find((x) => x.id === button.dataset.id);
        if (!entry || !window.confirm('Take this club out of the event?')) return;
        button.disabled = true;
        await removeEntry({ eventId: page.id, uid, entry });
        refresh();
      }

      if (act === 'clear-fixtures') {
        const b = page.b;
        const doomed = b.fixtures.filter((f) => !f.virtual && !b.results[f.id]);
        const kept = b.fixtures.filter((f) => !f.virtual && b.results[f.id]).length;
        const confirmation = window.prompt(
          `WARNING: Clearing fixtures during an event could be a serious mistake.\n\n`
          + `This permanently deletes ${doomed.length} fixture${doomed.length === 1 ? '' : 's'} without a result and their submitted score votes.\n`
          + `${kept} fixture${kept === 1 ? '' : 's'} with saved results will be kept.\n`
          + `It also unlocks the schedule, allowing automatic fixtures to rebuild from the current teams. This can disrupt tonight’s matches. There is no undo.\n\n`
          + `Only continue if you deliberately want to reset the remaining fixtures. Type CONFIRM exactly to continue, or press Cancel to keep them.`,
          '',
        );
        if (confirmation !== 'CONFIRM') return;
        button.disabled = true;
        await clearFixtures({ eventId: page.id, uid, fixtures: doomed, event: b.event, submissions: b.submissions });
        refresh();
      }
    } catch (err) {
      console.error(err);
      button.disabled = false;
      showError(root, failMessage(err));
    }
  });
}
