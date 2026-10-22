// Admin result entry for one fixture in an event: set scores, forfeits, player stat lines,
// MVP, VOD and screenshots. The form keeps a draft (`page.state`) and checks it live.
// /admin/result/<eventId>/<fixtureId>

import { loadEventBundle, NotFoundError } from '../../data.js';
import { checkResult } from '../../rules/match.js';
import { formatFor } from '../../rules/season.js';
import { forfeitSets, visibleSetCount, cleanStatLine, suggestMvp, reviewResult } from '../../rules/results.js';
import { voteLabel } from '../../rules/votes.js';
import { shotThumbs } from '../report.js';
import { saveResult, deleteResult, rememberGameNames } from '../../admin-data.js';
import { matchNames } from '../../rules/endscreen.js';
import { mediaUrl, oldMediaUrl } from '../../media.js';
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

// Players' result votes for this match (rules/votes.js), each with a button to copy it into the form.
const fixtureVotes = () => (page.b.submissions ?? []).filter((v) => v.fixtureId === page.fixture.id);

function votesPanel() {
  const { b } = page;
  const votes = fixtureVotes().sort((x, y) => (y.updatedAt ?? 0) - (x.updatedAt ?? 0));
  if (!votes.length) return '';
  return `
    <section class="panel">
      <h3 style="margin-bottom:6px">Players’ votes</h3>
      <p class="muted small" style="margin-bottom:8px">“Use” copies that vote’s scores and its team’s stats, plus the other team’s latest stats, into the form below.</p>
      <div class="rows">${votes.map((v) => `
        <div class="row">
          <span class="row-main"><b>${esc(b.playersById[v.playerId]?.displayName ?? v.playerId)} <span class="muted">(${esc(b.teamsById[v.teamId]?.name ?? v.teamId)})</span></b>
            <span class="small num">${esc(voteLabel(v.sets))} · ${Object.keys(v.playerStats ?? {}).length} stat lines${v.updatedAt ? ` · ${esc(fmtDay(v.updatedAt))}` : ''}</span>
            ${v.screenshotPaths?.length ? `<span class="vote-shots">${shotThumbs(v.screenshotPaths)}</span>` : '<span class="muted small">No screenshot</span>'}</span>
          <span class="row-side"><button type="button" class="btn btn-sm" data-act="use-vote" data-id="${esc(v.id)}">Use</button></span>
        </div>`).join('')}</div>
    </section>`;
}

// ---------- Reading stats from end-of-match screenshots ----------
// page.reading: { url, rows: [{ side, nameText, name, playerId, stats: { pts: { value, sure } | null } }] }
// page.aliases: [{ playerId, name }] in-game names to remember on save.

// Players this match could involve: both squads, both event rosters, anyone already entered.
function candidatePlayers() {
  const { b, state: s } = page;
  const ids = new Set();
  for (const teamId of [s.homeId, s.awayId]) {
    for (const p of Object.values(b.playersById)) if (p.teamId === teamId) ids.add(p.id);
    for (const pid of b.rosters[teamId]?.playerIds ?? []) ids.add(pid);
    for (const r of s.players[teamId]) ids.add(r.pid);
  }
  return [...ids].map((id) => b.playersById[id]).filter(Boolean);
}

const teamOfPlayer = (pid) => {
  const s = page.state;
  for (const teamId of [s.homeId, s.awayId]) {
    if (s.players[teamId].some((r) => r.pid === pid) || page.b.rosters[teamId]?.playerIds?.includes(pid) || page.b.playersById[pid]?.teamId === teamId) return teamId;
  }
  return null;
};

function screenshotsPanel() {
  const shots = fixtureVotes().flatMap((v) => (v.screenshotPaths ?? []).map((p) => ({ url: mediaUrl(p), who: page.b.playersById[v.playerId]?.displayName ?? v.playerId })));
  const r = page.reading;
  const players = candidatePlayers().sort((x, y) => x.displayName.localeCompare(y.displayName));
  const defs = statDefs();
  const cell = (row, i, d) => {
    const c = row.stats[d.key];
    if (c === null || c === undefined) return `<td><input type="number" min="0" inputmode="numeric" data-read-stat="${d.key}" data-row="${i}" value="" class="unread" title="Not on the screenshot (cut off)" placeholder="?"></td>`;
    return `<td><input type="number" min="0" inputmode="numeric" data-read-stat="${d.key}" data-row="${i}" value="${c.value}" class="${c.sure ? '' : 'unsure'}" ${c.sure ? '' : 'title="Check this one"'}></td>`;
  };
  return `
    <section class="panel shots-panel">
      <h3 style="margin-bottom:6px">Stats from screenshots</h3>
      <p class="muted small" style="margin-bottom:10px">Read a screenshot, check the names and numbers against it, then “Use these stats”. Yellow = check this number; “?” = not on the screenshot.</p>
      <div class="vote-shots read-shots">
        ${shots.map((s) => `<figure><a href="${esc(s.url)}" target="_blank" rel="noopener"><img src="${esc(s.url)}" alt="Screenshot from ${esc(s.who)}"></a>
          <figcaption><button type="button" class="btn btn-sm btn-primary" data-act="read-shot" data-url="${esc(s.url)}">Read stats</button> <span class="muted small">from ${esc(s.who)}</span></figcaption></figure>`).join('')}
        <figure class="upload-shot"><label class="btn btn-sm">Read a screenshot from this computer…<input type="file" accept="image/*" data-read-file hidden></label></figure>
      </div>
      <p class="small read-status" aria-live="polite">${esc(r?.message ?? '')}</p>
      ${r ? `
      <div class="read-view">
        <a href="${esc(r.url)}" target="_blank" rel="noopener" class="read-view-shot"><img src="${esc(r.url)}" alt="The screenshot being read"></a>
        <div class="table-wrap"><table class="data entry read-table">
          <thead><tr><th class="first">On screen → player</th>${defs.map((d) => `<th>${esc(d.label)}</th>`).join('')}</tr></thead>
          <tbody>${r.rows.map((row, i) => `
            <tr>
              <td class="first">
                <span class="small"><b>${esc(row.name || '?')}</b> <span class="muted">(${row.side})</span></span>
                <select data-assign="${i}"><option value="">Not one of ours / bot</option>${players.map((p) => `<option value="${esc(p.id)}"${row.playerId === p.id ? ' selected' : ''}>${esc(p.displayName)}${b_teamTag(p.id)}</option>`).join('')}</select>
              </td>
              ${defs.map((d) => cell(row, i, d)).join('')}
            </tr>`).join('')}</tbody>
        </table></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">
          <button type="button" class="btn btn-primary" data-act="use-reading">Use these stats</button>
          <button type="button" class="link-btn" data-act="clear-reading">Discard</button>
        </div>
      </div>` : ''}
    </section>`;
}
const b_teamTag = (pid) => {
  const t = teamOfPlayer(pid);
  return t ? ` · ${page.b.teamsById[t]?.shortName ?? ''}` : '';
};

async function readShot(root, source) {
  const status = root.querySelector('.read-status');
  const { readEndScreen } = await import('../../ocr.js');
  let blob = source;
  let url = typeof source === 'string' ? source : URL.createObjectURL(source);
  try {
    if (typeof source === 'string') {
      // Older screenshots may still be on the Cloudflare Worker.
      let res = await fetch(source);
      if (!res.ok && source.includes('/o/')) {
        url = oldMediaUrl(decodeURIComponent(source.split('/o/')[1].split('?')[0]));
        res = await fetch(url);
      }
      if (!res.ok) throw new Error('Couldn’t load that screenshot.');
      blob = await res.blob();
    }
    const out = await readEndScreen(blob, { onProgress: (t) => { status.textContent = t; } });
    const rows = out.panels.flatMap((panel, pi) => panel.rows.map((row) => ({ ...row, side: pi === 0 ? 'left' : 'right' })));
    const candidates = candidatePlayers().map((p) => ({ id: p.id, names: [p.displayName, ...(p.gameNames ?? [])] }));
    const matched = matchNames(rows.map((r) => r.name), candidates);
    rows.forEach((r, i) => { r.playerId = matched[i].playerId; });
    const found = rows.filter((r) => r.playerId).length;
    page.reading = { url, rows, message: `Read ${rows.length} players; ${found} matched by name automatically. Check every name and number against the screenshot.` };
  } catch (err) {
    console.error(err);
    status.textContent = err.message?.startsWith('Couldn’t find') ? err.message : 'Couldn’t read that screenshot. Try a full-screen PNG of the end-of-match screen.';
    return;
  }
  redraw(root);
  root.querySelector('.read-view')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

// Copies the checked reading into the result form (and remembers new in-game names).
function useReading(root) {
  const s = page.state;
  const r = page.reading;
  const keys = statKeys();
  root.querySelectorAll('[data-assign]').forEach((sel) => { r.rows[Number(sel.dataset.assign)].playerId = sel.value || null; });
  const unplaced = [];
  page.aliases = [];
  for (const [i, row] of r.rows.entries()) {
    if (!row.playerId) continue;
    const teamId = teamOfPlayer(row.playerId);
    if (!teamId) { unplaced.push(page.b.playersById[row.playerId]?.displayName ?? row.playerId); continue; }
    const line = Object.fromEntries(keys.map((k) => [k, root.querySelector(`[data-read-stat="${k}"][data-row="${i}"]`)?.value ?? '']));
    const list = s.players[teamId];
    const existing = list.find((x) => x.pid === row.playerId);
    if (existing) Object.assign(existing, { played: true, line });
    else list.push({ pid: row.playerId, played: true, line });
    const p = page.b.playersById[row.playerId];
    const known = [p?.displayName, ...(p?.gameNames ?? [])].some((n) => n && n.toLowerCase() === row.name.toLowerCase());
    // Remember the on-screen name (3+ letters, so short misreadings like "Ab" aren't kept).
    if (row.name?.length >= 3 && !known) page.aliases.push({ playerId: row.playerId, name: row.name });
  }
  // Players not in the reading didn't play.
  const read = new Set(r.rows.map((x) => x.playerId).filter(Boolean));
  for (const teamId of [s.homeId, s.awayId]) for (const x of s.players[teamId]) if (!read.has(x.pid)) x.played = false;
  page.reading = null;
  redraw(root);
  if (unplaced.length) showError(root, `${unplaced.join(', ')} isn’t on either team for this match. Add them under the right team below.`);
  const check = checkResult(draftResult().result.sets, page.format);
  if (check.ok && !s.mvp) {
    s.mvp = suggestMvp(draftResult().result.playerStats, check.winner === 'home' ? s.homeId : s.awayId) ?? '';
    updateLive(root);
  }
}

// Fills the form from a vote (scores in the fixture's home/away order, flipped if the admin swapped).
function useVote(vote) {
  const { fixture, format } = page;
  const s = page.state;
  const flip = s.homeId !== fixture.homeTeamId;
  s.mode = 'played';
  s.sets = Array.from({ length: format.bestOf }, (_, i) => {
    const set = vote.sets[i];
    if (!set) return { home: '', away: '' };
    return flip ? { home: String(set.away), away: String(set.home) } : { home: String(set.home), away: String(set.away) };
  });
  const latestFor = (teamId) => (teamId === vote.teamId ? vote
    : fixtureVotes().filter((v) => v.teamId === teamId).sort((x, y) => (y.updatedAt ?? 0) - (x.updatedAt ?? 0))[0]);
  for (const teamId of [s.homeId, s.awayId]) {
    const lines = Object.entries(latestFor(teamId)?.playerStats ?? {}).filter(([, l]) => l.teamId === teamId);
    if (!lines.length) continue;
    s.players[teamId] = lines.map(([pid, line]) => ({ pid, played: true, line: Object.fromEntries(statKeys().map((k) => [k, String(line[k] ?? 0)])) }));
  }
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
    ${votesPanel()}
    ${s.mode === 'played' ? screenshotsPanel() : ''}

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
  const back = ''; // the site-wide back button (app.js) goes to this event's fixtures

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
    if (e.target.matches('[data-read-file]') && e.target.files?.[0]) {
      readShot(root, e.target.files[0]);
      return;
    }
    if (e.target.closest('.read-table')) return; // the reading table isn't part of the result until "Use"
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

    if (button.dataset.act === 'read-shot') {
      button.disabled = true;
      await readShot(root, button.dataset.url);
      button.disabled = false;
      return;
    }
    if (button.dataset.act === 'use-reading') return useReading(root);
    if (button.dataset.act === 'clear-reading') {
      page.reading = null;
      redraw(root);
      return;
    }

    if (button.dataset.act === 'use-vote') {
      const vote = fixtureVotes().find((v) => v.id === button.dataset.id);
      if (vote) {
        useVote(vote);
        redraw(root);
      }
    }

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
        const { fixture, existing } = page;
        // Keep how the score was confirmed (players' votes), and mark stats as checked once there are some.
        const keep = existing?.source === 'votes' ? { source: 'votes', confirmedBy: existing.confirmedBy ?? [] } : {};
        const hasStats = Object.keys(result.playerStats ?? {}).length > 0;
        await saveResult({
          eventId: page.eventId,
          fixture,
          uid: page.user.uid,
          result: { ...keep, ...result, statsStatus: hasStats || result.forfeit ? 'reviewed' : (existing?.statsStatus ?? null) },
          existing,
          swapTeams: s.homeId !== fixture.homeTeamId ? { homeTeamId: s.homeId, awayTeamId: s.awayId } : null,
        });
        // Remember in-game names read from screenshots, so next time they match by themselves.
        if (page.aliases?.length) {
          await rememberGameNames({ uid: page.user.uid, aliases: page.aliases, playersById: page.b.playersById }).catch((err) => console.warn('Couldn’t save in-game names', err));
          page.aliases = [];
        }
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
