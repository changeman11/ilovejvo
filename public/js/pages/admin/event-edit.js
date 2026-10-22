// Admin: one event, in three tabs.
//   Details          title, dates (TBD allowed), links, visibility
//   Teams & rosters  which teams take part, and who plays for each
//   Fixtures         add/edit/delete matches (dates TBD allowed), enter results
// /admin/event/new?type=exhibition  or  /admin/event/<id>?tab=details|teams|fixtures[&edit=<fixtureId>|new]

import { loadEventBundle, loadPeople, NotFoundError } from '../../data.js';
import {
  EVENT_TYPES, EVENT_STATUSES, validateEvent, dateFromInputs, inputsFromDate, eventDateLabel,
} from '../../rules/events.js';
import { roundRobin, missingGames } from '../../rules/schedule.js';
import { saveEvent, deleteEvent, saveRoster, saveFixture, deleteFixture, addFixtures } from '../../admin-data.js';
import { navigate, refresh } from '../../nav.js';
import { esc, skeleton, fmtDay, fmtTime, teamDot, urls } from '../../ui.js';
import { resultOf } from '../parts.js';
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
      <section class="panel">
        <div class="field-row">
          <label class="field"><span>Players per team</span><input type="number" name="teamSize" min="1" max="12" inputmode="numeric" value="${esc(e.teamSize ?? 4)}"></label>
          <label class="field"><span>Matches are best of</span><select name="bestOf">${[3, 5].map((n) => opt(n, String(n), e.matchFormat?.bestOf ?? 3)).join('')}</select></label>
        </div>
        ${isTournament ? `
        <label class="field"><span>Format</span><input type="text" name="formatNote" maxlength="120" value="${esc(e.formatNote ?? '')}" placeholder="e.g. Round robin, then a best-of-5 final"></label>
        <label class="field"><span>Prize</span><input type="text" name="prize" maxlength="120" value="${esc(e.prize ?? '')}"></label>` : ''}
        <label class="check"><input type="checkbox" name="showTable" ${e.showTable ? 'checked' : ''}> Show a table (wins, sets, points) on the event page</label>
        <p class="muted small">Every set is first to 10, win by 2. A single fixture can be set to best of 5 (e.g. a final).</p>
      </section>
      <section class="panel">
        <label class="field"><span>Sign-up link</span><input type="url" name="signupUrl" value="${esc(e.signupUrl ?? '')}" placeholder="https://"></label>
        <label class="field"><span>Stream link</span><input type="url" name="streamUrl" value="${esc(e.streamUrl ?? '')}" placeholder="https://twitch.tv/…"></label>
        <label class="field"><span>Status</span><select name="status">${Object.entries(EVENT_STATUSES).map(([k, v]) => opt(k, v, e.status)).join('')}</select></label>
        <label class="check"><input type="checkbox" name="published" ${e.published ? 'checked' : ''}> Published (visible to everyone)</label>
      </section>
      <div class="save-bar">
        <button type="submit" class="btn btn-primary">${page.id ? 'Save details' : 'Create event'}</button>
        ${page.id ? '<button type="button" class="btn btn-danger" data-act="delete-event">Delete event</button>' : ''}
        <a class="link-btn" href="/admin" data-link>Cancel</a>
        <p class="form-error" role="alert" hidden></p>
      </div>
    </form>`;
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
    signupUrl: val('signupUrl').trim() || null,
    streamUrl: val('streamUrl').trim() || null,
    status: val('status'),
    published: form.querySelector('[name=published]').checked,
  };
}

// ---------- Teams tab ----------

function teamsHtml() {
  const { b, people } = page;
  const inEvent = new Set(b.event.teamIds ?? []);
  // Only approved teams can enter events (or ones already in this event).
  const teams = [...people.teams]
    .filter((t) => (t.status ?? 'approved') === 'approved' || inEvent.has(t.id))
    .sort((x, y) => x.name.localeCompare(y.name));
  const players = [...people.players].sort((x, y) => x.displayName.localeCompare(y.displayName));
  const rosterOf = (teamId) => new Set(b.rosters[teamId]?.playerIds ?? []);

  const rosterPanels = teams.filter((t) => inEvent.has(t.id)).map((t) => {
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
      <section class="panel" data-teams>
        <div class="section-head"><h3>Teams in this event</h3><a href="/admin/people" data-link>Add teams &amp; players</a></div>
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
      <label class="field"><span>Label (optional)</span><input type="text" name="label" maxlength="60" value="${esc(f?.label ?? '')}" placeholder="e.g. Match 1, Semi-final, Showmatch"></label>
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

function fixturesHtml(editId) {
  const { b } = page;
  const list = [...b.fixtures].sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
  const rows = list.map((f) => {
    const home = b.teamsById[f.homeTeamId];
    const away = b.teamsById[f.awayTeamId];
    const { result, check } = resultOf(b, f);
    const when = f.scheduledAt ? `${fmtDay(f.scheduledAt)} ${f.timeTbd ? '· Time TBD' : fmtTime(f.scheduledAt)}` : 'Date TBD';
    const status = check?.ok ? `<span class="tag tag-live">${check.homeSets}–${check.awaySets}</span>` : result ? '<span class="tag tag-draft">Check result</span>' : '';
    return `
      <div class="row">
        <span class="row-main">
          <b><span class="team">${teamDot(home)}${esc(home?.name ?? 'TBC')}</span> v <span class="team">${esc(away?.name ?? 'TBC')}${teamDot(away)}</span></b>
          <span class="muted small">${[f.label, when, f.bestOf ? `Best of ${f.bestOf}` : ''].filter(Boolean).map(esc).join(' · ')}</span>
        </span>
        <span class="row-side">
          ${status}
          <a class="btn btn-sm btn-primary" href="${urls.adminResult(b.event.id, f.id)}" data-link>${result ? 'Edit result' : 'Result'}</a>
          <a class="btn btn-sm" href="${urls.adminEvent(b.event.id, 'fixtures')}&edit=${encodeURIComponent(f.id)}" data-link data-keep-scroll>Edit</a>
          <button type="button" class="btn btn-sm btn-danger" data-act="delete-fixture" data-id="${esc(f.id)}">Delete</button>
        </span>
      </div>
      ${editId === f.id ? fixtureForm(f) : ''}`;
  }).join('');

  return `
    <div class="stack">
      <div class="event-links">
        <a class="btn btn-primary" href="${urls.adminEvent(b.event.id, 'fixtures')}&edit=new" data-link data-keep-scroll>+ Add fixture</a>
        ${b.teams.length >= 2 ? `
        <button type="button" class="btn" data-act="round-robin" data-legs="1">Auto fixtures: everyone plays once</button>
        <button type="button" class="btn" data-act="round-robin" data-legs="2">Auto fixtures: home &amp; away</button>` : ''}
      </div>
      ${editId === 'new' ? `<section class="panel flush">${fixtureForm(null)}</section>` : ''}
      <section class="panel flush rows">${rows || '<p class="muted" style="padding:16px">No fixtures yet.</p>'}</section>
      <p class="muted small">Times are entered in your own time zone; visitors see them in theirs.</p>
      <p class="form-error" role="alert" hidden></p>
    </div>`;
}

// ---------- Page ----------

export async function render({ eventId }) {
  const gate = await adminGate();
  if (gate.html) return { title: 'Admin sign-in', html: `<div class="admin-root">${gate.html}</div>` };

  const params = new URLSearchParams(location.search);
  const isNew = eventId === 'new';
  let b = null;
  if (!isNew) b = await loadEventBundle(eventId, { fresh: true, admin: true });
  if (!isNew && !b) throw new NotFoundError('That event doesn’t exist');
  const people = await loadPeople({ fresh: true, admin: true });
  const askedType = params.get('type');
  const draft = b?.event ?? { type: EVENT_TYPES[askedType] ? askedType : 'exhibition', status: 'upcoming', published: false, date: null, timeTbd: true, teamSize: 4, teamIds: [] };
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
    // Switching type redraws the details form (tournaments have extra fields).
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

    if (act === 'tick-squad') {
      const ids = new Set(button.dataset.ids.split(','));
      root.querySelectorAll(`[data-roster="${CSS.escape(button.dataset.team)}"] .tick-list input`).forEach((i) => { i.checked = ids.has(i.value); });
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

      if (act === 'round-robin') {
        const twice = button.dataset.legs === '2';
        const teamIds = page.b.teams.map((t) => t.id);
        const games = missingGames(roundRobin(teamIds, { double: twice }), page.b.fixtures);
        if (!games.length) {
          window.alert('Every matchup already has a fixture. Nothing to add.');
          return;
        }
        const how = twice ? 'every team plays every other team twice (home and away)' : 'every team plays every other team once';
        if (!window.confirm(`Add ${games.length} fixture${games.length === 1 ? '' : 's'} so ${how}? Matchups that already have a fixture are skipped. Dates will be TBD.`)) return;
        button.disabled = true;
        let order = Math.max(0, ...page.b.fixtures.map((f) => f.order ?? 0));
        await addFixtures({
          eventId: page.id,
          uid,
          fixtures: games.map((g) => ({
            label: `Round ${g.round}`, homeTeamId: g.homeTeamId, awayTeamId: g.awayTeamId,
            scheduledAt: null, bestOf: null, order: (order += 1), status: 'scheduled',
          })),
        });
        refresh();
      }
    } catch (err) {
      console.error(err);
      button.disabled = false;
      showError(root, failMessage(err));
    }
  });
}
