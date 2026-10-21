// Admin result entry: set scores, forfeits, player stat lines, MVP, VOD and screenshots.
// The form keeps its own draft (`page.state`) and checks it live against the season's rules.

import { loadSeason, NotFoundError } from '../../data.js';
import { checkResult } from '../../rules/match.js';
import { forfeitSets, visibleSetCount, cleanStatLine, suggestMvp, reviewResult } from '../../rules/results.js';
import { saveResult, deleteResult } from '../../admin-data.js';
import { navigate } from '../../nav.js';
import { esc, skeleton, notice, safeUrl, fmtLongDay, fmtTime, teamChip, urls } from '../../ui.js';
import { formatFor, roundLabel } from '../../rules/season.js';
import { advanceUpdates } from '../../rules/playoffs.js';
import { statHeads } from '../parts.js';
import { adminGate, adminBar, bindAuthActions } from './gate.js';

export const title = 'Enter result';

export function loading() {
  return `<div class="grid">${skeleton([60, 120, 220, 300])}</div>`;
}

// The page currently open: { seasonId, fixtureId, data, fixture, existing, user, state }
let page = null;

const statDefsOf = (data) => data.season.stats ?? [];
const statKeysOf = (data) => statDefsOf(data).map((s) => s.key);

function initialState(fixture, existing, data) {
  const statKeys = statKeysOf(data);
  const sets = Array.from({ length: formatFor(data.season, fixture).bestOf }, (_, i) => {
    const s = !existing?.forfeit && existing?.sets?.[i];
    return { home: s ? String(s.home) : '', away: s ? String(s.away) : '' };
  });

  // Each team's rows: this season's roster, plus anyone with a saved stat line for the team.
  const players = {};
  for (const teamId of [fixture.homeTeamId, fixture.awayTeamId]) {
    const ids = [...(data.rosters[teamId]?.playerIds ?? [])];
    for (const [pid, line] of Object.entries(existing?.playerStats ?? {})) {
      if (line.teamId === teamId && !ids.includes(pid)) ids.push(pid);
    }
    players[teamId] = ids.map((pid) => {
      const line = existing?.playerStats?.[pid];
      const played = line?.teamId === teamId;
      return { pid, played, line: Object.fromEntries(statKeys.map((k) => [k, played ? String(line[k] ?? 0) : ''])) };
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

// Builds the result that would be saved, plus anything that blocks saving.
function draftResult() {
  const { state: s, data } = page;
  const format = page.format;
  const problems = [];
  let result;

  if (s.mode === 'forfeit') {
    if (!s.forfeitTeamId) problems.push('Pick which team didn’t play');
    const winner = s.forfeitTeamId === s.homeId ? 'away' : 'home';
    result = {
      sets: forfeitSets(format, winner),
      playerStats: {},
      mvpPlayerId: null,
      forfeit: s.forfeitTeamId ? { teamId: s.forfeitTeamId } : null,
    };
  } else {
    const nums = numericSets(s.sets);
    const sets = nums.slice(0, visibleSetCount(nums, format));
    const playerStats = {};
    for (const teamId of [s.homeId, s.awayId]) {
      for (const row of s.players[teamId]) {
        if (row.played) playerStats[row.pid] = { teamId, ...cleanStatLine(row.line, statKeysOf(data)) };
      }
    }
    result = {
      sets,
      playerStats,
      mvpPlayerId: s.mvp && playerStats[s.mvp] ? s.mvp : null,
      forfeit: null,
    };
    problems.push(...checkResult(sets, format).errors);
  }

  const vod = s.vod.trim();
  if (vod && !safeUrl(vod)) problems.push('The VOD link must be a full web address starting with https://');
  const shotLines = s.shots.split('\n').map((l) => l.trim()).filter(Boolean);
  if (shotLines.some((l) => !safeUrl(l))) problems.push('Each screenshot link must be a full web address starting with https://');
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
  const { data, state: s } = page;
  const team = data.teamsById[teamId];
  const statDefs = statDefsOf(data);
  const rows = s.players[teamId].map((row) => {
    const name = data.playersById[row.pid]?.displayName ?? row.pid;
    const inputs = statDefs.map((st) => `
      <td><input type="number" inputmode="numeric" min="0" data-stat="${esc(st.key)}" value="${esc(row.line[st.key])}" aria-label="${esc(name)} ${esc(st.name)}"></td>`).join('');
    return `
      <tr data-pid="${esc(row.pid)}" data-team="${esc(teamId)}" class="${row.played ? '' : 'off'}">
        <td class="team-col"><label class="played-toggle"><input type="checkbox" data-played ${row.played ? 'checked' : ''}> ${esc(name)}</label></td>
        ${inputs}
      </tr>`;
  }).join('');

  const listed = new Set(s.players[teamId].map((r) => r.pid));
  const options = Object.values(data.playersById)
    .filter((p) => !listed.has(p.id))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .map((p) => `<option value="${esc(p.id)}">${esc(p.displayName)}</option>`)
    .join('');

  return `
    <section class="card">
      <div class="section-head"><h2 class="with-chip">${teamChip(team, 'lg')}${esc(team?.name ?? teamId)}</h2><span class="muted small played-count" data-team="${esc(teamId)}"></span></div>
      <p class="muted small" style="margin:0 0 8px">Tick who played, then copy their numbers from the end-of-match screen. Blank = 0.</p>
      <div class="table-wrap"><table class="data entry-table">
        <thead><tr><th class="team-col">Player</th>${statHeads(statDefs)}</tr></thead>
        <tbody>${rows || `<tr><td class="team-col muted" colspan="${statDefs.length + 1}">No roster for this team. Add players below.</td></tr>`}</tbody>
      </table></div>
      <label class="field add-player"><span>Add a sub or ringer</span>
        <select data-add-player="${esc(teamId)}"><option value="">Choose a player…</option>${options}</select>
      </label>
    </section>`;
}

function mvpOptions() {
  const { data, state: s } = page;
  const groups = [s.homeId, s.awayId].map((teamId) => {
    const opts = s.players[teamId]
      .filter((r) => r.played)
      .map((r) => `<option value="${esc(r.pid)}" ${r.pid === s.mvp ? 'selected' : ''}>${esc(data.playersById[r.pid]?.displayName ?? r.pid)}</option>`)
      .join('');
    return opts ? `<optgroup label="${esc(data.teamsById[teamId]?.name ?? teamId)}">${opts}</optgroup>` : '';
  }).join('');
  return `<option value="">No MVP</option>${groups}`;
}

function formHtml() {
  const { data, fixture, existing, state: s, seasonId, fixtureId } = page;
  const home = data.teamsById[s.homeId];
  const away = data.teamsById[s.awayId];
  const swapped = s.homeId !== fixture.homeTeamId;

  const forfeitPick = `
    <fieldset class="choice-list">
      <legend>Which team didn’t play?</legend>
      ${[s.homeId, s.awayId].map((id) => `
        <label><input type="radio" name="forfeitTeam" value="${esc(id)}" ${s.forfeitTeamId === id ? 'checked' : ''}> ${teamChip(data.teamsById[id])} ${esc(data.teamsById[id]?.name ?? id)}</label>`).join('')}
    </fieldset>
    <p class="muted small">Recorded as a win for the other team with every set ${page.format.pointsPerSet}–0, and no player stats.</p>`;

  return `
    <section class="card entry-head">
      <span class="eyebrow">${esc(data.season.name)} · ${esc(roundLabel(data.season, fixture))} · ${fmtLongDay(fixture.scheduledAt)} ${fmtTime(fixture.scheduledAt)}</span>
      <h1 class="entry-teams">${teamChip(home, 'lg')}${esc(home?.name ?? 'TBC')} <span class="muted">vs</span> ${esc(away?.name ?? 'TBC')}${teamChip(away, 'lg')}</h1>
      <div class="entry-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-act="swap">⇄ Swap home/away</button>
        ${swapped ? '<span class="tag">Swapped: the fixture will be saved this way round</span>' : ''}
        <a class="small" href="${urls.match(seasonId, fixtureId)}" data-link>Public match page →</a>
      </div>
    </section>

    <section class="card">
      <div class="section-head"><h2>Result</h2></div>
      <div class="segmented" role="radiogroup" aria-label="Result type">
        <label><input type="radio" name="mode" value="played" ${s.mode === 'played' ? 'checked' : ''}><span>Played</span></label>
        <label><input type="radio" name="mode" value="forfeit" ${s.mode === 'forfeit' ? 'checked' : ''}><span>Forfeit</span></label>
      </div>
      ${s.mode === 'forfeit' ? forfeitPick : setsBlock(s, home, away)}
    </section>

    ${s.mode === 'played' ? `${playersCard(s.homeId)}${playersCard(s.awayId)}` : ''}

    <section class="card">
      <div class="section-head"><h2>Extras</h2></div>
      ${s.mode === 'played' ? `
      <div class="field"><span>Match MVP</span>
        <div class="field-row">
          <select name="mvp">${mvpOptions()}</select>
          <button type="button" class="btn btn-ghost btn-sm" data-act="suggest-mvp">Suggest</button>
        </div>
      </div>` : ''}
      <label class="field"><span>VOD link</span><input type="url" name="vod" placeholder="https://youtube.com/…" value="${esc(s.vod)}"></label>
      <label class="field"><span>Screenshot links (one per line)</span><textarea name="shots" rows="3" placeholder="https://…">${esc(s.shots)}</textarea></label>
    </section>

    <section class="card review-card" hidden>
      <div class="section-head"><h2>Before you save</h2></div>
      <ul class="flags review"></ul>
    </section>

    <div class="save-bar">
      <button type="button" class="btn" data-act="save">${existing ? 'Save changes' : 'Save result'}</button>
      ${existing ? '<button type="button" class="btn btn-danger" data-act="delete">Delete result</button>' : ''}
      <a class="link-btn" href="/admin/matchday?season=${encodeURIComponent(seasonId)}" data-link>Cancel</a>
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
  const mvp = root.querySelector('[name=mvp]');
  if (mvp) s.mvp = mvp.value;
  const vod = root.querySelector('[name=vod]');
  if (vod) s.vod = vod.value;
  const shots = root.querySelector('[name=shots]');
  if (shots) s.shots = shots.value;
}

function updateLive(root) {
  const { data, state: s } = page;
  const format = page.format;
  const teamSize = format.teamSize ?? 4;

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
      const winner = data.teamsById[check.winner === 'home' ? s.homeId : s.awayId];
      status.className = 'set-status ok';
      status.textContent = `${winner?.name ?? 'Winner'} win ${Math.max(check.homeSets, check.awaySets)}–${Math.min(check.homeSets, check.awaySets)} · points ${check.homePoints}–${check.awayPoints}`;
    } else {
      status.className = 'set-status bad';
      status.textContent = check.errors[0];
    }

    for (const teamId of [s.homeId, s.awayId]) {
      const n = s.players[teamId].filter((r) => r.played).length;
      const el = root.querySelector(`.played-count[data-team="${CSS.escape(teamId)}"]`);
      if (el) {
        el.textContent = `${n} of ${teamSize} ticked`;
        el.classList.toggle('warn', n !== teamSize);
      }
    }
    root.querySelectorAll('tr[data-pid]').forEach((tr) => tr.classList.toggle('off', !tr.querySelector('[data-played]').checked));

    const mvp = root.querySelector('[name=mvp]');
    if (mvp) mvp.innerHTML = mvpOptions();
  }

  // Review: blocking problems first, then softer "something to check" notes.
  const { result, problems } = draftResult();
  const { warnings } = reviewResult(result, {
    homeTeamId: s.homeId,
    awayTeamId: s.awayId,
    format,
    teamSize,
    rosters: data.rosters,
    teamNames: Object.fromEntries(Object.values(data.teamsById).map((t) => [t.id, t.name])),
  });
  const card = root.querySelector('.review-card');
  const list = root.querySelector('.review');
  const items = [
    ...problems.filter((p) => !p.startsWith('Set ') && !p.startsWith('Match isn')).map((p) => `<li class="err">${esc(p)}</li>`),
    ...warnings.map((w) => `<li>${esc(w)}</li>`),
  ];
  list.innerHTML = items.join('');
  card.hidden = items.length === 0;
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

export async function render({ seasonId, fixtureId }) {
  const gate = await adminGate();
  if (gate.html) return { title: 'Admin sign-in', html: `<div class="admin-root">${gate.html}</div>` };

  const data = await loadSeason(seasonId, { fresh: true });
  const fixture = data.fixtures.find((f) => f.id === fixtureId);
  if (!fixture) throw new NotFoundError('That fixture doesn’t exist');
  const existing = data.results[fixtureId] ?? null;

  if (!fixture.homeTeamId || !fixture.awayTeamId) {
    return {
      title: 'Enter result',
      html: `<div class="admin-root">${adminBar(gate.user, gate.admin)}
        <a class="back" href="/admin/matchday?season=${encodeURIComponent(seasonId)}" data-link>← Match day</a>
        ${notice('Teams not decided yet', ` The ${roundLabel(data.season, fixture)} teams fill in automatically once the earlier rounds have results.`)}</div>`,
    };
  }

  page = { seasonId, fixtureId, data, fixture, existing, user: gate.user, format: formatFor(data.season, fixture) };
  page.state = initialState(fixture, existing, data);

  const home = data.teamsById[fixture.homeTeamId]?.shortName ?? 'TBC';
  const away = data.teamsById[fixture.awayTeamId]?.shortName ?? 'TBC';
  return {
    title: `${existing ? 'Edit' : 'Enter'} result: ${home} vs ${away}`,
    html: `
      <div class="admin-root">
        ${adminBar(gate.user, gate.admin)}
        <a class="back" href="/admin/matchday?season=${encodeURIComponent(seasonId)}" data-link>← Match day</a>
        <div class="entry grid">${formHtml()}</div>
      </div>`,
  };
}

export function mount(el) {
  const root = el.querySelector('.admin-root');
  if (!root) return;
  bindAuthActions(root);
  if (!root.querySelector('.entry')) return; // sign-in panel only
  updateLive(root);

  root.addEventListener('input', (e) => {
    // Typing a stat ticks that player as having played.
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
      const teamId = add.dataset.addPlayer;
      s.players[teamId].push({ pid: add.value, played: true, line: Object.fromEntries(statKeysOf(page.data).map((k) => [k, ''])) });
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
        const { fixture, data } = page;
        const swapTeams = s.homeId !== fixture.homeTeamId ? { homeTeamId: s.homeId, awayTeamId: s.awayId } : null;
        // Playoffs: fill in the next round's teams in the same save.
        const fixturesAfter = data.fixtures.map((f) => (f.id === fixture.id ? { ...f, ...(swapTeams ?? {}) } : f));
        const advance = advanceUpdates(data.season, fixturesAfter, { ...data.results, [fixture.id]: result });
        await saveResult({
          seasonId: page.seasonId,
          fixtureId: page.fixtureId,
          uid: page.user.uid,
          result,
          existing: page.existing,
          swapTeams,
          advance,
        });
        navigate(urls.match(page.seasonId, page.fixtureId));
      } catch (err) {
        console.error(err);
        button.disabled = false;
        button.textContent = page.existing ? 'Save changes' : 'Save result';
        showError(root, err.code === 'permission-denied'
          ? 'Not allowed to save. Are you still on the admin list?'
          : 'Couldn’t save. Check your connection and try again.');
      }
    }

    if (button.dataset.act === 'delete') {
      if (!window.confirm('Delete this result? The match goes back to “not played” and the table updates straight away.')) return;
      button.disabled = true;
      try {
        const { [page.fixtureId]: _removed, ...resultsAfter } = page.data.results;
        const advance = advanceUpdates(page.data.season, page.data.fixtures, resultsAfter);
        await deleteResult({ seasonId: page.seasonId, fixtureId: page.fixtureId, uid: page.user.uid, advance });
        navigate(`/admin/matchday?season=${encodeURIComponent(page.seasonId)}`);
      } catch (err) {
        console.error(err);
        button.disabled = false;
        showError(root, 'Couldn’t delete. Check your connection and try again.');
      }
    }
  });
}
