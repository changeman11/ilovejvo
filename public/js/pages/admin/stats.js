// Admin stats list: every match whose score is in and whose stats are waiting. Each shows what the
// screenshot reading says per team (players confirm or fix their own lines in the Discord match
// thread), with plain-language problems. Staff tick the ones that look right and press "Submit
// selected"; anything wrong goes to "Edit" (the full result page).
// /admin/stats

import { loadAllBundles } from '../../data.js';
import { saveResult, rememberGameNames } from '../../admin-data.js';
import { checkResult } from '../../rules/match.js';
import { formatFor } from '../../rules/season.js';
import { suggestMvp } from '../../rules/results.js';
import { draftSummary, playerStatsFromDraft } from '../../rules/stats-draft.js';
import { shotFor } from '../../stats-reader.js';
import { mediaUrl } from '../../media.js';
import { esc, skeleton, teamDot, urls } from '../../ui.js';
import { refresh } from '../../nav.js';
import { adminGate, adminBar, bindAuthActions } from './gate.js';

export const title = 'Stats to submit';

export function loading() {
  return skeleton([50, 240, 240]);
}

let page = null;

// Everything about one waiting match the page needs.
function item(b, f) {
  const result = b.results[f.id];
  const statKeys = (b.season.stats ?? []).map((s) => s.key);
  const ctx = { homeTeamId: f.homeTeamId, awayTeamId: f.awayTeamId, playersById: b.playersById, rosters: b.rosters };
  const summary = draftSummary(result, ctx, statKeys);
  const shot = shotFor(b, f, result);
  const reading = result.statsDraft?.reading && Date.now() - (result.statsDraft.at ?? 0) < 3 * 60 * 1000;
  // Squad players with no line: they may not have played (or weren't read).
  const squad = (teamId) => Object.values(b.playersById).filter((p) => p.teamId === teamId).map((p) => p.id);
  const missing = [f.homeTeamId, f.awayTeamId].flatMap((t) => squad(t)).filter((pid) => !summary.lines.some((l) => l.playerId === pid));
  const problems = [];
  if (!shot) problems.push('No screenshot yet');
  else if (reading) problems.push('Reading the screenshot…');
  else if (result.statsDraft?.error) problems.push('The screenshot couldn’t be read: use Edit');
  else if (!summary.total) problems.push('Not read yet');
  if (summary.unknown.length) problems.push(`${summary.unknown.length} name${summary.unknown.length === 1 ? '' : 's'} nobody has claimed: ${summary.unknown.join(', ')}`);
  if (summary.offTeam.length) problems.push(`${summary.offTeam.map((pid) => b.playersById[pid]?.displayName ?? pid).join(', ')} isn’t on either team`);
  const unsure = summary.lines.filter((l) => l.unsure).length;
  if (unsure) problems.push(`${unsure} unconfirmed line${unsure === 1 ? '' : 's'} with numbers the reader wasn’t sure of`);
  return { b, f, result, statKeys, summary, shot, missing, problems, ready: summary.total > 0, allConfirmed: summary.total > 0 && summary.confirmed === summary.total };
}

function teamTable(it, teamId) {
  const { b, statKeys, summary } = it;
  const defs = b.season.stats ?? [];
  const lines = summary.lines.filter((l) => l.teamId === teamId);
  const missing = it.missing.filter((pid) => b.playersById[pid]?.teamId === teamId);
  const team = b.teamsById[teamId];
  const mark = (l) => (l.edited ? '<span title="Fixed by a player">✏️</span>' : l.confirmed ? '<span title="Confirmed by the player or captain">✅</span>' : '<span title="Not confirmed yet">⏳</span>');
  return `
    <div class="sl-team">
      <b class="team">${teamDot(team)}${esc(team?.name ?? 'TBC')}</b>
      <div class="table-wrap"><table class="data sl-table">
        <thead><tr><th class="first">Player</th>${defs.map((d) => `<th>${esc(d.label)}</th>`).join('')}</tr></thead>
        <tbody>
          ${lines.map((l) => `<tr class="${l.unsure ? 'unsure' : ''}"><td class="first">${mark(l)} ${esc(b.playersById[l.playerId]?.displayName ?? l.playerId)}${l.name && l.name !== b.playersById[l.playerId]?.displayName ? ` <span class="muted small">(“${esc(l.name)}” on screen)</span>` : ''}</td>${statKeys.map((k) => `<td class="num">${l.stats[k] ?? '?'}</td>`).join('')}</tr>`).join('')}
          ${missing.map((pid) => `<tr class="off"><td class="first">⚪ ${esc(b.playersById[pid]?.displayName ?? pid)} <span class="muted small">not on the screenshot</span></td>${statKeys.map(() => '<td></td>').join('')}</tr>`).join('')}
        </tbody>
      </table></div>
    </div>`;
}

function card(it, i) {
  const { b, f, summary } = it;
  const check = checkResult(it.result.sets ?? [], formatFor(b.season, f));
  const name = (id) => esc(b.teamsById[id]?.name ?? 'TBC');
  const status = !it.ready ? '<span class="sl-chip grey">Waiting</span>'
    : it.allConfirmed ? '<span class="sl-chip ok">✅ All confirmed</span>'
      : `<span class="sl-chip warn">${summary.confirmed}/${summary.total} confirmed</span>`;
  return `
    <section class="panel sl-card${it.allConfirmed ? ' all-ok' : ''}">
      <div class="sl-head">
        <label class="sl-tick"><input type="checkbox" data-pick="${i}" ${it.ready ? '' : 'disabled'} ${it.allConfirmed && !it.problems.length ? 'checked' : ''}>
          <span><b>${name(f.homeTeamId)} ${check.ok ? `${check.homeSets}–${check.awaySets}` : 'v'} ${name(f.awayTeamId)}</b>
          <span class="muted small">${esc(b.event.title)}${f.label ? ` · ${esc(f.label)}` : ''}</span></span></label>
        <span class="sl-side">${status}
          <a class="btn btn-sm" href="${urls.adminResult(b.event.id, f.id)}" data-link>✏️ Edit</a></span>
      </div>
      ${it.problems.length ? `<ul class="sl-problems">${it.problems.map((p) => `<li>⚠️ ${esc(p)}</li>`).join('')}</ul>` : ''}
      ${it.ready ? `<div class="sl-body">
        ${it.shot ? `<a class="sl-shot" href="${esc(mediaUrl(it.shot))}" target="_blank" rel="noopener"><img src="${esc(mediaUrl(it.shot))}" alt="End-of-match screenshot" loading="lazy"></a>` : ''}
        <div class="sl-teams">${teamTable(it, f.homeTeamId)}${teamTable(it, f.awayTeamId)}</div>
      </div>` : ''}
    </section>`;
}

// Every match waiting for stats: ready to submit first, then those waiting on something.
export function waitingItems(bundles) {
  return bundles.flatMap((b) => b.fixtures
    .filter((f) => !f.virtual && b.results[f.id] && !b.results[f.id].forfeit && b.results[f.id].statsStatus === 'pending')
    .map((f) => item(b, f)))
    .sort((x, y) => Number(y.allConfirmed) - Number(x.allConfirmed) || Number(y.ready) - Number(x.ready));
}
export const cardsHtml = (items) => items.map(card).join('');

export async function render() {
  const gate = await adminGate();
  if (gate.html) return { title: 'Admin sign-in', html: `<div class="admin-root">${gate.html}</div>` };
  const items = waitingItems(await loadAllBundles({ includeDrafts: true }));
  page = { user: gate.user, items };
  const ready = items.filter((it) => it.ready).length;
  return {
    title: 'Stats to submit',
    html: `
      <div class="admin-root">
        ${adminBar(gate.user, gate.admin, '/admin/stats')}
        <div class="page-head">
          <div><h1>Stats to submit</h1>
            <p class="muted">Read from each match’s end-of-match screenshot. Players confirm (✅) or fix (✏️) their own lines in the Discord match thread. Tick the ones that look right and submit them together. Anything wrong: <b>Edit</b>.</p></div>
        </div>
        ${items.length ? `
        <div class="sl-bar">
          <label class="check"><input type="checkbox" data-all> Select all ready (${ready})</label>
          <button class="btn btn-primary" type="button" data-submit>Submit selected</button>
          <span class="small sl-msg" role="status"></span>
        </div>
        <div class="stack">${cardsHtml(items)}</div>` : '<section class="panel"><p class="muted" style="margin:0">Nothing waiting. Matches show up here once their score is in.</p></section>'}
      </div>`,
  };
}

function selected(root) {
  return [...root.querySelectorAll('[data-pick]:checked')].map((el) => page.items[Number(el.dataset.pick)]).filter(Boolean);
}

function updateBar(root) {
  const n = selected(root).length;
  const button = root.querySelector('[data-submit]');
  if (button) {
    button.textContent = n ? `Submit ${n} selected` : 'Submit selected';
    button.disabled = !n;
  }
}

async function submit(root) {
  const items = selected(root);
  const msg = root.querySelector('.sl-msg');
  const button = root.querySelector('[data-submit]');
  if (!items.length) return;
  const warn = items.filter((it) => it.problems.length || !it.allConfirmed).length;
  if (warn && !window.confirm(`${warn} of these still have something flagged or unconfirmed lines. Submit them anyway?`)) return;
  button.disabled = true;
  let done = 0;
  const failed = [];
  for (const it of items) {
    msg.textContent = `Saving ${done + 1} of ${items.length}…`;
    try {
      const { b, f, result, statKeys, summary } = it;
      const playerStats = playerStatsFromDraft(summary, statKeys);
      const check = checkResult(result.sets ?? [], formatFor(b.season, f));
      const { id, statsDraft, updatedAt, updatedBy, enteredAt, enteredBy, ...keep } = result;
      await saveResult({
        eventId: b.event.id,
        fixture: f,
        uid: page.user.uid,
        existing: result,
        result: {
          ...keep,
          playerStats,
          mvpPlayerId: result.mvpPlayerId ?? (check.ok ? suggestMvp(playerStats, check.winner === 'home' ? f.homeTeamId : f.awayTeamId) : null),
          statsStatus: 'reviewed',
        },
      });
      // Remember on-screen names, so the reader matches them by itself next time.
      const aliases = summary.lines
        .filter((l) => l.name && l.name.length >= 3)
        .filter((l) => ![b.playersById[l.playerId]?.displayName, ...(b.playersById[l.playerId]?.gameNames ?? [])].some((n) => n && n.toLowerCase() === l.name.toLowerCase()))
        .map((l) => ({ playerId: l.playerId, name: l.name }));
      if (aliases.length) await rememberGameNames({ uid: page.user.uid, aliases, playersById: b.playersById }).catch((err) => console.warn('In-game names:', err));
      done++;
    } catch (err) {
      console.error(err);
      failed.push(`${it.b.teamsById[it.f.homeTeamId]?.name ?? '?'} v ${it.b.teamsById[it.f.awayTeamId]?.name ?? '?'}`);
    }
  }
  if (failed.length) {
    msg.textContent = `Submitted ${done}. Couldn’t save: ${failed.join(', ')}.`;
    button.disabled = false;
    return;
  }
  refresh(); // the submitted matches drop off the list
}

export function mount(el) {
  const root = el.querySelector('.admin-root');
  if (!root) return;
  bindAuthActions(root);
  if (!page) return;
  updateBar(root);
  root.addEventListener('change', (e) => {
    if (e.target.matches('[data-all]')) {
      root.querySelectorAll('[data-pick]:not(:disabled)').forEach((c) => { c.checked = e.target.checked; });
    }
    updateBar(root);
  });
  root.querySelector('[data-submit]')?.addEventListener('click', () => submit(root));
}
