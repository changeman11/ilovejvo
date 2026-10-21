// Admin: add or edit an exhibition night / tournament.
// /admin/event/new?type=exhibition   or   /admin/event/<id>

import { loadAllEvents, NotFoundError } from '../../data.js';
import {
  EVENT_TYPES, EVENT_STATUSES, validateEvent, dateFromInputs, inputsFromDate, eventDateLabel,
} from '../../rules/events.js';
import { saveEvent, deleteEvent } from '../../admin-data.js';
import { navigate } from '../../nav.js';
import { esc, skeleton } from '../../ui.js';
import { adminGate, adminBar, bindAuthActions } from './gate.js';

export const title = 'Edit event';

export function loading() {
  return `<div class="grid">${skeleton([60, 420])}</div>`;
}

let page = null; // { id, existing, user }

const opt = (value, label, current) => `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(label)}</option>`;

function formHtml(e) {
  const { dateStr, timeStr } = inputsFromDate(e.date, e.timeTbd);
  const isTournament = e.type === 'tournament';
  return `
    <section class="card">
      <label class="field"><span>Type</span>
        <select name="type">${Object.entries(EVENT_TYPES).map(([k, v]) => opt(k, v.label, e.type)).join('')}</select>
      </label>
      <label class="field"><span>Title</span><input type="text" name="title" maxlength="120" required value="${esc(e.title ?? '')}" placeholder="${isTournament ? 'e.g. Summer Cup' : 'e.g. Friday Showmatch Night'}"></label>
      <label class="field"><span>Short summary (shown on cards)</span><textarea name="summary" rows="2" maxlength="280">${esc(e.summary ?? '')}</textarea></label>
      <label class="field"><span>Details (shown on the event page; leave a blank line between paragraphs)</span><textarea name="details" rows="6">${esc(e.details ?? '')}</textarea></label>
    </section>

    <section class="card">
      <div class="section-head"><h2>When</h2><span class="muted small date-preview">${esc(eventDateLabel(e))}</span></div>
      <div class="field-row two">
        <label class="field"><span>Date (empty = TBD)</span><input type="date" name="date" value="${esc(dateStr)}"></label>
        <label class="field"><span>Time (empty = TBD)</span><input type="time" name="time" value="${esc(timeStr)}"></label>
      </div>
      <button type="button" class="link-btn" data-act="clear-date">Set back to TBD</button>
    </section>

    ${isTournament ? `
    <section class="card">
      <div class="section-head"><h2>Tournament details</h2></div>
      <label class="field"><span>Format</span><input type="text" name="format" maxlength="120" value="${esc(e.format ?? '')}" placeholder="e.g. Groups then single elimination"></label>
      <div class="field-row two">
        <label class="field"><span>Players per team</span><input type="number" name="teamSize" min="1" max="12" inputmode="numeric" value="${esc(e.teamSize ?? 4)}"></label>
        <label class="field"><span>Prize</span><input type="text" name="prize" maxlength="120" value="${esc(e.prize ?? '')}" placeholder="e.g. Discord role + bragging rights"></label>
      </div>
    </section>` : ''}

    <section class="card">
      <div class="section-head"><h2>Links</h2></div>
      <label class="field"><span>${isTournament ? 'Sign-up link' : 'Join / sign-up link'}</span><input type="url" name="signupUrl" value="${esc(e.signupUrl ?? '')}" placeholder="https://"></label>
      <label class="field"><span>Stream link</span><input type="url" name="streamUrl" value="${esc(e.streamUrl ?? '')}" placeholder="https://twitch.tv/…"></label>
    </section>

    <section class="card">
      <div class="section-head"><h2>Visibility</h2></div>
      <label class="field"><span>Status</span>
        <select name="status">${Object.entries(EVENT_STATUSES).map(([k, v]) => opt(k, v, e.status)).join('')}</select>
      </label>
      <label class="check"><input type="checkbox" name="published" ${e.published ? 'checked' : ''}> Published (visible to everyone)</label>
    </section>

    <div class="save-bar">
      <button type="button" class="btn" data-act="save">${page.id ? 'Save changes' : 'Add event'}</button>
      ${page.id ? '<button type="button" class="btn btn-danger" data-act="delete">Delete</button>' : ''}
      <a class="link-btn" href="/admin" data-link>Cancel</a>
      <p class="form-error" role="alert" hidden></p>
    </div>`;
}

// Reads the form into an event object (date as ms or null).
function readForm(root) {
  const val = (name) => root.querySelector(`[name=${name}]`)?.value ?? '';
  const type = val('type');
  const { date, timeTbd } = dateFromInputs(val('date'), val('time'));
  const e = {
    type,
    title: val('title').trim(),
    summary: val('summary').trim(),
    details: val('details').trim(),
    date,
    timeTbd,
    status: val('status'),
    published: root.querySelector('[name=published]').checked,
    signupUrl: val('signupUrl').trim() || null,
    streamUrl: val('streamUrl').trim() || null,
  };
  if (type === 'tournament') {
    e.format = val('format').trim() || null;
    e.teamSize = val('teamSize') === '' ? null : Number(val('teamSize'));
    e.prize = val('prize').trim() || null;
  } else {
    e.format = null;
    e.teamSize = null;
    e.prize = null;
  }
  return e;
}

function showError(root, message) {
  const el = root.querySelector('.form-error');
  el.textContent = message;
  el.hidden = false;
}

export async function render({ eventId }) {
  const gate = await adminGate();
  if (gate.html) return { title: 'Admin sign-in', html: `<div class="admin-root">${gate.html}</div>` };

  let existing = null;
  if (eventId !== 'new') {
    existing = (await loadAllEvents()).find((e) => e.id === eventId);
    if (!existing) throw new NotFoundError('That event doesn’t exist');
  }
  const askedType = new URLSearchParams(location.search).get('type');
  const draft = existing ?? {
    type: EVENT_TYPES[askedType] ? askedType : 'exhibition',
    status: 'upcoming',
    published: false,
    date: null,
    timeTbd: true,
    teamSize: 4,
  };
  page = { id: existing?.id ?? null, existing, user: gate.user };

  const heading = existing ? 'Edit' : `New ${EVENT_TYPES[draft.type].label.toLowerCase()}`;
  return {
    title: heading,
    html: `
      <div class="admin-root">
        ${adminBar(gate.user, gate.admin)}
        <a class="back" href="/admin" data-link>← Events</a>
        <section class="hero"><span class="eyebrow">Admin</span><h1>${esc(heading)}</h1></section>
        <div class="entry grid">${formHtml(draft)}</div>
      </div>`,
  };
}

export function mount(el) {
  const root = el.querySelector('.admin-root');
  if (!root) return;
  bindAuthActions(root);
  const form = root.querySelector('.entry');
  if (!form) return;

  const refreshPreview = () => {
    const e = readForm(root);
    root.querySelector('.date-preview').textContent = eventDateLabel(e);
  };

  root.addEventListener('input', (e) => {
    if (e.target.matches('[name=date], [name=time]')) refreshPreview();
  });

  root.addEventListener('change', (e) => {
    // Switching type redraws the form (tournaments have extra fields); keep what was typed.
    if (e.target.matches('[name=type]')) {
      form.innerHTML = formHtml(readForm(root));
    }
  });

  root.addEventListener('click', async (e) => {
    const button = e.target.closest('[data-act]');
    if (!button) return;

    if (button.dataset.act === 'clear-date') {
      root.querySelector('[name=date]').value = '';
      root.querySelector('[name=time]').value = '';
      refreshPreview();
    }

    if (button.dataset.act === 'save') {
      const event = readForm(root);
      const problems = validateEvent(event);
      if (problems.length) return showError(root, `Can’t save yet: ${problems[0]}`);
      button.disabled = true;
      button.textContent = 'Saving…';
      try {
        await saveEvent({ id: page.id, uid: page.user.uid, event, existing: page.existing });
        navigate('/admin');
      } catch (err) {
        console.error(err);
        button.disabled = false;
        button.textContent = page.id ? 'Save changes' : 'Add event';
        showError(root, err.code === 'permission-denied'
          ? 'Not allowed to save. Are you still on the admin list?'
          : 'Couldn’t save. Check your connection and try again.');
      }
    }

    if (button.dataset.act === 'delete') {
      if (!window.confirm('Delete this event? This can’t be undone.')) return;
      button.disabled = true;
      try {
        await deleteEvent({ id: page.id, uid: page.user.uid });
        navigate('/admin');
      } catch (err) {
        console.error(err);
        button.disabled = false;
        showError(root, 'Couldn’t delete. Check your connection and try again.');
      }
    }
  });
}
