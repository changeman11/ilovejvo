// Admin result entry for one fixture in an event: set scores, forfeits, player stat lines,
// MVP, VOD and screenshots. The form keeps a draft (`page.state`) and checks it live.
// /admin/result/<eventId>/<fixtureId>

import { loadEventBundle, NotFoundError } from '../../data.js';
import { checkResult } from '../../rules/match.js';
import { formatFor } from '../../rules/season.js';
import { forfeitSets, visibleSetCount, cleanStatLine, suggestMvp, reviewResult } from '../../rules/results.js';
import { saveResult, deleteResult } from '../../admin-data.js';
import { navigate } from '../../nav.js';
import { esc, skeleton, notice, safeUrl, fmtDay, fmtTime, teamDot, urls } from '../../ui.js';
import { statHeads } from '../parts.js';
import { adminGate, adminBar, bindAuthActions } from './gate.js';

export const title = 'Enter result';

export function loading() {
  return skeleton([60, 160, 300]);
}

// The page currently open: { eventId, b, fixture, existing, user, format, teamSize, state }
let page = null;

const statDefs = () => page.b.season.stats ?? [];
const statKeys = () => statDefs().map((s) => s.key);

function initialState(fixture, existing, b) {
  const sets = Array.from({ length: page.format.bestOf }, (_, i) => {
    const s = !existing?.forfeit && existing?.sets?.[i];
    return { home: s ? String(s.home) : '', away: s ? String(s.away) : '' };
  });
  // Each team's rows: the event roster, plus anyone with a saved stat line for the team.
  const players = {};
  for (const teamId of [fixture.homeTeamId, fixture.awayTeamId]) {
    const ids = [...(b.rosters[teamId]?.playerIds ?? [])];
    for (const [pid, line] of Object.entries(existing?.playerStats ?? {})) {
      if (line.teamId === teamId && !ids.includes(pid)) ids.push(pid);
    }
    players[teamId] = ids.map((pid) => {
      const line = existing?.playerStats?.[pid];
      const played = line?.teamId === teamId;
      return { pid, played, line: Object.fromEntries(statKeys().map((k) => [k, played ? String(line[k] ?? 0) : ''])) };
    });
  }
  return {
    homeId: fixture.homeTeamId,
    awayId: fixture.awayTeamId,
    mode: existing?.forfeit ? 'forfeit' : 'played',
    forfeitTeamId: existing?.forfeit?.teamId ?? '',
    sets,
    players,
    mvp: existing?.mvpPlayerId ?? '',
    vod: existing?.vodUrl ?? '',
    shots: (existing?.screenshots ?? []).join('\n'),
  };
}

const numericSets = (sets) => sets.map((s) => ({
  home: s.home === '' ? NaN : Number(s.home),
  away: s.away === '' ? NaN : Number(s.away),
}));

// The result that would be saved, plus anything that blocks saving.
function draftResult() {
  const s = page.state;
  const problems = [];
  let result;
  if (s.mode === 'forfeit') {
    if (!s.forfeitTeamId) problems.push('Pick which team didn’t play');
    result = {
      sets: forfeitSets(page.format, s.forfeitTeamId === s.homeId ? 'away' : 'home'),
      playerStats: {},
      mvpPlayerId: null,
      forfeit: s.forfeitTeamId ? { teamId: s.forfeitTeamId } : null,
    };
  } else {
    const nums = numericSets(s.sets);
    const sets = nums.slice(0, visibleSetCount(nums, page.format));
    const playerStats = {};
    for (const teamId of [s.homeId, s.awayId]) {
      for (const row of s.players[teamId]) {
        if (row.played) playerStats[row.pid] = { teamId, ...cleanStatLine(row.line, statKeys()) };
      }
    }
    result = { sets, playerStats, mvpPlayerId: s.mvp && playerStats[s.mvp] ? s.mvp : null, forfeit: null };
    problems.push(...checkResult(sets, page.format).errors);
  }
  const vod = s.vod.trim();
  if (vod && !safeUrl(vod)) problems.push('The VOD link must be a full web address starting with https://');
  const shotLines = s.shots.split('\n').map((l) => l.trim()).filter(Boolean);
  if (shotLines.some((l) => !safeUrl(l))) problems.push('Each screenshot link must start with https://');
  result.vodUrl = vod ? safeUrl(vod) : null;
  result.screenshots = shotLines.map(safeUrl).filter(Boolean);
  return { result, problems };
}

// ---------- Drawing ----------

function setsBlock(s, home, away) {
  const visible = visibleSetCount(numericSets(s.sets), page.format);
  const rows = s.sets.map((set, i) => `
    <div class="set-row" data-set="${i}" ${i >= visible ? 'hidden' : ''}>
      <span>Set ${i + 1}</span>
      <input type="number" inputmode="numeric" min="0" name="set-${i}-home" value="${esc(set.home)}" aria-label="Set ${i + 1} ${esc(home?.name)}">
      <input type="number" inputmode="numeric" min="0" name="set-${i}-away" value="${esc(set.away)}" aria-label="Set ${i + 1} ${esc(away?.name)}">
    </div>`).join('');
  return `
    <div class="sets-entry">
      <div class="set-row set-head"><span></span><span>${esc(home?.shortName ?? 'Home')}</span><span>${esc(away?.shortName ?? 'Away')}</span></div>
      ${rows}
    </div>
    <p class="set-status" aria-live="polite"></p>`;
}

function playersCard(teamId) {
  const { b, state: s } = page;
  const team = b.teamsById[teamId];
  const defs = statDefs();
  const rows = s.players[teamId].map((row) => {
    const name = b.playersById[row.pid]?.displayName ?? row.pid;
    return `
      <tr data-pid="${esc(row.pid)}" data-team="${esc(teamId)}" class="${row.played ? '' : 'off'}">
        <td class="first"><label class="played-toggle"><input type="checkbox" data-played ${row.played ? 'checked' : ''}> ${esc(name)}</label></td>
        ${defs.map((st) => `<td><input type="number" inputmode="numeric" min="0" data-stat="${esc(st.key)}" value="${esc(row.line[st.key])}" aria-label="${esc(name)} ${esc(st.name)}"></td>`).join('')}
      </tr>`;
  }).join('');
  const listed = new Set(s.players[teamId].map((r) => r.pid));
  const options = Object.values(b.playersById)
    .filter((p) => !listed.has(p.id))
    .sort((x, y) => x.displayName.localeCompare(y.displayName))
    .map((p) => `<option value="${esc(p.id)}">${esc(p.displayName)}</option>`)
    .join('');
  return `
    <section>
      <div class="section-head"><h2><span class="team">${teamDot(team, 'lg')}${esc(team?.name ?? teamId)}</span></h2><span class="muted small played-count" data-team="${esc(teamId)}"></span></div>
      <div class="panel flush">
        <p class="muted small" style="padding:12px 14px 0">Tick who played and copy their numbers from the end-of-match screen. Blank = 0.</p>
        <div class="table-wrap"><table class="data entry">
          <thead><tr><th class="first">Player</th>${statHeads(defs)}</tr></thead>
          <tbody>${rows || `<tr><td class="first muted" colspan="${defs.length + 1}">No roster yet. Add players below, or set the roster on the event’s Teams tab.</td></tr>`}</tbody>
        </table></div>
        <div class="inline-form"><label class="field"><span>Add a player</span><select data-add-player="${esc(teamId)}"><option value="">Choose a player…</option>${options}</select></label></div>
      </div>
    </section>`;
}

function mvpOptions() {
  const { b, state: s } = page;
  const groups = [s.homeId, s.awayId].map((teamId) => {
    const opts = s.players[teamId]
      .filter((r) => r.played)
      .map((r) => `<option value="${esc(r.pid)}" ${r.pid === s.mvp ? 'selected' : ''}>${esc(b.playersById[r.pid]?.displayName ?? r.pid)}</option>`)
      .join('');
    return opts ? `<optgroup label="${esc(b.teamsById[teamId]?.name ?? teamId)}">${opts}</optgroup>` : '';
  }).join('');
  return `<option value="">No MVP</option>${groups}`;
}

function formHtml() {
  const { b, fixture, existing, state: s, eventId } = page;
  const home = b.teamsById[s.homeId];
  const away = b.teamsById[s.awayId];
  const swapped = s.homeId !== fixture.homeTeamId;
  const when = fixture.scheduledAt ? `${fmtDay(fixture.scheduledAt)} ${fixture.timeTbd ? '· Time TBD' : fmtTime(fixture.scheduledAt)}` : 'Date TBD';

  const forfeitPick = `
    <fieldset style="border:0;padding:0;margin:0 0 8px">
      <legend style="font-weight:800;margin-bottom:8px">Which team didn’t play?</legend>
      ${[s.homeId, s.awayId].map((id) => `<label class="check"><input type="radio" name="forfeitTeam" value="${esc(id)}" ${s.forfeitTeamId === id ? 'checked' : ''}> ${teamDot(b.teamsById[id])} ${esc(b.teamsById[id]?.name ?? id)}</label>`).join('')}
    </fieldset>
    <p class="muted small">Counts as a win for the other team, every set ${page.format.pointsPerSet}–0, no player stats.</p>`;

  return `
    <section class="panel">
      <p class="muted small">${esc(b.event.title)}${fixture.label ? ` · ${esc(fixture.label)}` : ''} · ${esc(when)} · Best of ${page.format.bestOf}</p>
      <h1 style="margin:6px 0 10px"><span class="team">${teamDot(home, 'lg')}${esc(home?.name ?? 'TBC')}</span> <span class="muted">v</span> <span class="team">${esc(away?.name ?? 'TBC')}${teamDot(away, 'lg')}</span></h1>
      <div class="event-links">
        <button type="button" class="btn btn-sm" data-act="swap">⇄ Swap home/away</button>
        <a class="btn btn-sm" href="${urls.match(eventId, fixture.id)}" data-link>Public match page</a>
      </div>
      ${swapped ? '<p class="small" style="margin-top:8px;font-weight:700">Swapped: the fixture will be saved this way round.</p>' : ''}
    </section>

    <section class="panel">
      <div class="segmented" role="radiogroup" aria-label="Result type">
        <label><input type="radio" name="mode" value="played" ${s.mode === 'played' ? 'checked' : ''}><span>Played</span></label>
        <label><input type="radio" name="mode" value="forfeit" ${s.mode === 'forfeit' ? 'checked' : ''}><span>Forfeit</span></label>
      </div>
      ${s.mode === 'forfeit' ? forfeitPick : setsBlock(s, home, away)}
    </section>

    ${s.mode === 'played' ? `${playersCard(s.homeId)}${playersCard(s.awayId)}` : ''}

    <section class="panel">
      ${s.mode === 'played' ? `
      <div class="field"><span>Match MVP</span>
        <div style="display:flex;gap:8px"><select name="mvp">${mvpOptions()}</select><button type="button" class="btn btn-sm" data-act="suggest-mvp">Suggest</button></div>
      </div>` : ''}
      <label class="field"><span>VOD link</span><input type="url" name="vod" placeholder="https://youtube.com/…" value="${esc(s.vod)}"></label>
      <label class="field" style="margin:0"><span>Screenshot links (one per line)</span><textarea name="shots" rows="3" placeholder="https://…">${esc(s.shots)}</textarea></label>
    </section>

    <section class="panel review-card" hidden>
      <h3 style="margin-bottom:6px">Before you save</h3>
      <ul class="flags review"></ul>
    </section>

    <div class="save-bar">
      <button type="button" class="btn btn-primary" data-act="save">${existing ? 'Save changes' : 'Save result'}</button>
      ${existing ? '<button type="button" class="btn btn-danger" data-act="delete">Delete result</button>' : ''}
      <a class="link-btn" href="${urls.adminEvent(eventId, 'fixtures')}" data-link>Cancel</a>
      <p class="form-error" role="alert" hidden></p>
    </div>`;
}

// ---------- Reading the form and live updates ----------

function readForm(root) {
  const s = page.state;
  s.mode = root.querySelector('input[name=mode]:checked')?.value ?? s.mode;
  const ff = root.querySelector('input[name=forfeitTeam]:checked');
  if (ff) s.forfeitTeamId = ff.value;
  s.sets.forEach((set, i) => {
    const h = root.querySelector(`[name=set-${i}-home]`);
    const a = root.querySelector(`[name=set-${i}-away]`);
    if (h && a) { set.home = h.value; set.away = a.value; }
  });
  root.querySelectorAll('tr[data-pid]').forEach((tr) => {
    const row = s.players[tr.dataset.team]?.find((r) => r.pid === tr.dataset.pid);
    if (!row) return;
    row.played = tr.querySelector('[data-played]').checked;
    tr.querySelectorAll('[data-stat]').forEach((input) => { row.line[input.dataset.stat] = input.value; });
  });
  for (const name of ['mvp', 'vod', 'shots']) {
    const el = root.querySelector(`[name=${name}]`);
    if (el) s[name] = el.value;
  }
}

function updateLive(root) {
  const { b, state: s, format, teamSize } = page;
  if (s.mode === 'played') {
    const nums = numericSets(s.sets);
    const visible = visibleSetCount(nums, format);
    root.querySelectorAll('.set-row[data-set]').forEach((row) => { row.hidden = Number(row.dataset.set) >= visible; });
    const shown = nums.slice(0, visible);
    const status = root.querySelector('.set-status');
    const filled = shown.every((x) => !Number.isNaN(x.home) && !Number.isNaN(x.away));
    const check = checkResult(shown, format);
    if (!filled) {
      status.className = 'set-status';
      status.textContent = 'Enter each set’s score.';
    } else if (check.ok) {
      const winner = b.teamsById[check.winner === 'home' ? s.homeId : s.awayId];
      status.className = 'set-status ok';
      status.textContent = `${winner?.name ?? 'Winner'} win ${Math.max(check.homeSets, check.awaySets)}–${Math.min(check.homeSets, check.awaySets)} · points ${check.homePoints}–${check.awayPoints}`;
    } else {
      status.className = 'set-status bad';
      status.textContent = check.errors[0];
    }
    for (const teamId of [s.homeId, s.awayId]) {
      const n = s.players[teamId].filter((r) => r.played).length;
      const el = root.querySelector(`.played-count[data-team="${CSS.escape(teamId)}"]`);
      if (el) el.textContent = `${n} of ${teamSize} ticked`;
    }
    root.querySelectorAll('tr[data-pid]').forEach((tr) => tr.classList.toggle('off', !tr.querySelector('[data-played]').checked));
    const mvp = root.querySelector('[name=mvp]');
    if (mvp) mvp.innerHTML = mvpOptions();
  }

  const { result, problems } = draftResult();
  const { warnings } = reviewResult(result, {
    homeTeamId: s.homeId,
    awayTeamId: s.awayId,
    format,
    teamSize,
    rosters: b.rosters,
    teamNames: Object.fromEntries(Object.values(b.teamsById).map((t) => [t.id, t.name])),
  });
  const items = [
    ...problems.filter((p) => !p.startsWith('Set ') && !p.startsWith('Match isn')).map((p) => `<li class="err">${esc(p)}</li>`),
    ...warnings.map((w) => `<li>${esc(w)}</li>`),
  ];
  root.querySelector('.review').innerHTML = items.join('');
  root.querySelector('.review-card').hidden = items.length === 0;
}

function redraw(root) {
  root.querySelector('.entry').innerHTML = formHtml();
  updateLive(root);
}

function showError(root, message) {
  const el = root.querySelector('.form-error');
  el.textContent = message;
  el.hidden = false;
}

// ---------- Page hooks ----------

export async function render({ eventId, fixtureId }) {
  const gate = await adminGate();
  if (gate.html) return { title: 'Admin sign-in', html: `<div class="admin-root">${gate.html}</div>` };

  const b = await loadEventBundle(eventId, { fresh: true, admin: true });
  const fixture = b.fixtures.find((f) => f.id === fixtureId);
  if (!fixture) throw new NotFoundError('That fixture doesn’t exist');
  const back = `<a class="back" href="${urls.adminEvent(eventId, 'fixtures')}" data-link>← ${esc(b.event.title)} fixtures</a>`;

  if (!fixture.homeTeamId || !fixture.awayTeamId) {
    return {
      title: 'Enter result',
      html: `<div class="admin-root">${adminBar(gate.user, gate.admin)}${back}${notice('Teams not set yet', ' Pick both teams for this fixture first.')}</div>`,
    };
  }

  const existing = b.results[fixtureId] ?? null;
  const format = formatFor(b.season, fixture);
  page = { eventId, b, fixture, existing, user: gate.user, format, teamSize: b.event.teamSize ?? format.teamSize ?? 4 };
  page.state = initialState(fixture, existing, b);

  const home = b.teamsById[fixture.homeTeamId]?.shortName ?? 'TBC';
  const away = b.teamsById[fixture.awayTeamId]?.shortName ?? 'TBC';
  return {
    title: `${existing ? 'Edit' : 'Enter'} result: ${home} v ${away}`,
    html: `
      <div class="admin-root">
        ${adminBar(gate.user, gate.admin, '/admin')}
        ${back}
        <div class="entry stack">${formHtml()}</div>
      </div>`,
  };
}

export function mount(el) {
  const root = el.querySelector('.admin-root');
  if (!root) return;
  bindAuthActions(root);
  if (!root.querySelector('.entry')) return;
  updateLive(root);

  root.addEventListener('input', (e) => {
    const statInput = e.target.closest('[data-stat]');
    if (statInput && statInput.value !== '') statInput.closest('tr').querySelector('[data-played]').checked = true;
    readForm(root);
    updateLive(root);
  });

  root.addEventListener('change', (e) => {
    const s = page.state;
    if (e.target.matches('input[name=mode], input[name=forfeitTeam]')) {
      readForm(root);
      redraw(root);
      return;
    }
    const add = e.target.closest('[data-add-player]');
    if (add && add.value) {
      readForm(root);
      s.players[add.dataset.addPlayer].push({ pid: add.value, played: true, line: Object.fromEntries(statKeys().map((k) => [k, ''])) });
      redraw(root);
      return;
    }
    readForm(root);
    updateLive(root);
  });

  root.addEventListener('click', async (e) => {
    const button = e.target.closest('[data-act]');
    if (!button) return;
    const s = page.state;
    readForm(root);

    if (button.dataset.act === 'swap') {
      [s.homeId, s.awayId] = [s.awayId, s.homeId];
      s.sets = s.sets.map((x) => ({ home: x.away, away: x.home }));
      redraw(root);
    }

    if (button.dataset.act === 'suggest-mvp') {
      const { result } = draftResult();
      const check = checkResult(result.sets, page.format);
      if (!check.ok) return showError(root, 'Enter valid set scores first, so we know who won.');
      s.mvp = suggestMvp(result.playerStats, check.winner === 'home' ? s.homeId : s.awayId) ?? '';
      updateLive(root);
    }

    if (button.dataset.act === 'save') {
      const { result, problems } = draftResult();
      if (problems.length) return showError(root, `Can’t save yet: ${problems[0]}`);
      button.disabled = true;
      button.textContent = 'Saving…';
      try {
        const { fixture } = page;
        await saveResult({
          eventId: page.eventId,
          fixture,
          uid: page.user.uid,
          result,
          existing: page.existing,
          swapTeams: s.homeId !== fixture.homeTeamId ? { homeTeamId: s.homeId, awayTeamId: s.awayId } : null,
        });
        navigate(urls.match(page.eventId, fixture.id));
      } catch (err) {
        console.error(err);
        button.disabled = false;
        button.textContent = page.existing ? 'Save changes' : 'Save result';
        showError(root, err.code === 'permission-denied' ? 'Not allowed to save. Are you still on the admin list?' : 'Couldn’t save. Check your connection and try again.');
      }
    }

    if (button.dataset.act === 'delete') {
      if (!window.confirm('Delete this result? The match goes back to “not played”.')) return;
      button.disabled = true;
      try {
        await deleteResult({ eventId: page.eventId, fixture: page.fixture, uid: page.user.uid, existing: page.existing });
        navigate(urls.adminEvent(page.eventId, 'fixtures'));
      } catch (err) {
        console.error(err);
        button.disabled = false;
        showError(root, 'Couldn’t delete. Check your connection and try again.');
      }
    }
  });
}
