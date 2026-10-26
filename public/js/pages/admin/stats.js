// Admin stats list: every match whose score is in and whose stats are waiting, read from the
// end-of-match screenshot (the Discord bot reads it; players confirm or fix their lines in the
// match thread). Built to be quick for staff and hard to cheat (reworked 2026-10-25):
//   - Ready to publish: read, every line placed, nothing unsure, and no fraud warnings
//     (rules/stat-checks.js). One button publishes all of them; nothing to tick.
//   - Check before publishing: fraud warnings (unusually high numbers, PTS that don't add up,
//     numbers changed by a captain or the player, lines named by hand that don't look like them).
//     Each is published on its own, after a look ("Publish anyway"), or fixed with Edit.
//   - Waiting: no screenshot yet, names nobody has claimed, numbers the reader wasn't sure of.
// /admin/stats
//
// The full result page (Edit) is unchanged.

import { loadAllBundles } from '../../data.js';
import { saveResult, rememberGameNames } from '../../admin-data.js';
import { checkResult } from '../../rules/match.js';
import { formatFor } from '../../rules/season.js';
import { suggestMvp } from '../../rules/results.js';
import { draftSummary, playerStatsFromDraft } from '../../rules/stats-draft.js';
import { statFlags, perSetHighs, setsPlayed } from '../../rules/stat-checks.js';
import { shotFor } from '../../stats-reader.js';
import { mediaUrl } from '../../media.js';
import { esc, skeleton, teamDot, urls } from '../../ui.js';
import { refresh } from '../../nav.js';
import { adminGate, adminBar, bindAuthActions } from './gate.js';

export const title = 'Stats to publish';

export function loading() {
  return skeleton([50, 240, 240]);
}

let page = null;

// Every saved stat line so far, with its match's sets: what "normal" is learned from.
function history(bundles) {
  return bundles.flatMap((b) => Object.values(b.results)
    .filter((r) => r.statsStatus === 'reviewed' && !r.forfeit)
    .flatMap((r) => Object.values(r.playerStats ?? {}).map((stats) => ({ stats, sets: setsPlayed(r.sets) }))));
}

// Everything about one waiting match the page needs.
function item(b, f, perSet) {
  const result = b.results[f.id];
  const defs = b.season.stats ?? [];
  const statKeys = defs.map((s) => s.key);
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
  const flags = statFlags(summary.lines, {
    sets: result.sets, homeTeamId: f.homeTeamId, awayTeamId: f.awayTeamId,
    playersById: b.playersById, teamsById: b.teamsById, perSet,
    labels: Object.fromEntries(defs.map((d) => [d.key, d.label])),
  });
  const ready = summary.total > 0;
  const group = !ready ? 'waiting' : flags.length ? 'flagged' : problems.length ? 'waiting' : 'clean';
  return { b, f, result, statKeys, summary, shot, missing, problems, flags, ready, group, allConfirmed: ready && summary.confirmed === summary.total };
}

function teamTable(it, teamId) {
  const { b, statKeys, summary } = it;
  const defs = b.season.stats ?? [];
  const lines = summary.lines.filter((l) => l.teamId === teamId);
  const missing = it.missing.filter((pid) => b.playersById[pid]?.teamId === teamId);
  const team = b.teamsById[teamId];
  const flagged = new Set(it.flags.map((x) => x.playerId).filter(Boolean));
  const mark = (l) => (flagged.has(l.playerId) ? '<span title="See the warnings above">⚠️</span>'
    : l.edited ? '<span title="Changed by hand">✏️</span>' : l.confirmed ? '<span title="Confirmed by the player or captain">✅</span>' : '<span title="Not confirmed (read from the screenshot)">📷</span>');
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
      : `<span class="sl-chip ${it.group === 'clean' ? 'ok' : 'warn'}">${summary.confirmed}/${summary.total} confirmed</span>`;
  const body = it.ready ? `<div class="sl-body">
        ${it.shot ? `<a class="sl-shot" href="${esc(mediaUrl(it.shot))}" target="_blank" rel="noopener"><img src="${esc(mediaUrl(it.shot))}" alt="End-of-match screenshot" loading="lazy"></a>` : ''}
        <div class="sl-teams">${teamTable(it, f.homeTeamId)}${teamTable(it, f.awayTeamId)}</div>
      </div>` : '';
  return `
    <section class="panel sl-card${it.group === 'flagged' ? ' flagged' : it.group === 'clean' ? ' all-ok' : ''}">
      <div class="sl-head">
        <span><b>${name(f.homeTeamId)} ${check.ok ? `${check.homeSets}–${check.awaySets}` : 'v'} ${name(f.awayTeamId)}</b>
          <span class="muted small">${esc(b.event.title)}${f.label ? ` · ${esc(f.label)}` : ''}</span></span>
        <span class="sl-side">${status}
          ${it.ready && it.group !== 'clean' ? `<button class="btn btn-sm" type="button" data-one="${i}">Publish anyway</button>` : ''}
          ${it.group !== 'clean' ? `<button class="btn btn-sm" type="button" data-nostats="${i}" title="No screenshot and no way to get one: keep the score, no player stats">Publish with no stats</button>` : ''}
          <a class="btn btn-sm" href="${urls.adminResult(b.event.id, f.id)}" data-link>✏️ Edit</a></span>
      </div>
      ${it.flags.length ? `<ul class="sl-flags">${it.flags.map((x) => `<li>🚩 ${esc(x.text)}</li>`).join('')}</ul>` : ''}
      ${it.problems.length ? `<ul class="sl-problems">${it.problems.map((p) => `<li>⚠️ ${esc(p)}</li>`).join('')}</ul>` : ''}
      ${it.group === 'clean' ? `<details><summary>Show the numbers</summary>${body}</details>` : body}
    </section>`;
}

// Every match waiting for stats, each with its group ('clean' | 'flagged' | 'waiting').
export function waitingItems(bundles) {
  const perSet = perSetHighs(history(bundles), ['pts', 'spk', 'blk', 'rec', 'set', 'ast', 'ace', 'dig']);
  return bundles.flatMap((b) => b.fixtures
    .filter((f) => !f.virtual && b.results[f.id] && !b.results[f.id].forfeit && b.results[f.id].statsStatus === 'pending')
    .map((f) => item(b, f, perSet)));
}

const GROUPS = [
  { key: 'clean', title: '✅ Ready to publish', note: 'Read from the screenshot, every player placed, nothing unusual. Publish them all in one go.' },
  { key: 'flagged', title: '🚩 Check before publishing', note: 'Something could be cheating or a mistake. Compare with the screenshot, then publish or fix with Edit.' },
  { key: 'waiting', title: '⏳ Waiting', note: 'Waiting for a screenshot, for players to answer Who’s who, or for unsure numbers to be confirmed. Publish anyway if you’ve checked them. No screenshot and no way to get one? “Publish with no stats” keeps the score and leaves the stats out.' },
];

export async function render() {
  const gate = await adminGate();
  if (gate.html) return { title: 'Admin sign-in', html: `<div class="admin-root">${gate.html}</div>` };
  const items = waitingItems(await loadAllBundles({ includeDrafts: true }));
  page = { user: gate.user, items };
  const clean = items.filter((it) => it.group === 'clean').length;
  const sections = GROUPS.map((g) => {
    const list = items.map((it, i) => [it, i]).filter(([it]) => it.group === g.key);
    if (!list.length) return '';
    return `
      <div class="sl-group">
        <div><h2>${g.title} (${list.length})</h2><p class="muted">${g.note}</p></div>
        ${g.key === 'clean' ? `<button class="btn btn-primary" type="button" data-all-clean>Publish all ${list.length}</button>` : ''}
      </div>
      <div class="stack">${list.map(([it, i]) => card(it, i)).join('')}</div>`;
  }).join('');
  return {
    title: 'Stats to publish',
    html: `
      <div class="admin-root">
        ${adminBar(gate.user, gate.admin, '/admin/stats')}
        <div class="page-head">
          <div><h1>Stats to publish</h1>
            <p class="muted">The bot reads each match’s end-of-match screenshot. Clean matches publish in one click; anything unusual is flagged 🚩 for a look first. Numbers changed by captains or players are always flagged.</p></div>
        </div>
        ${items.length ? `<p class="small sl-msg" role="status">${clean ? '' : 'Nothing is ready to publish in one go right now.'}</p>${sections}`
          : '<section class="panel"><p class="muted" style="margin:0">Nothing waiting. Matches show up here once their score is in.</p></section>'}
      </div>`,
  };
}

async function publish(root, items) {
  const msg = root.querySelector('.sl-msg');
  root.querySelectorAll('[data-all-clean], [data-one]').forEach((btn) => { btn.disabled = true; });
  let done = 0;
  const failed = [];
  for (const it of items) {
    msg.textContent = `Publishing ${done + 1} of ${items.length}…`;
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
    msg.textContent = `Published ${done}. Couldn’t save: ${failed.join(', ')}.`;
    root.querySelectorAll('[data-all-clean], [data-one]').forEach((btn) => { btn.disabled = false; });
    return;
  }
  refresh(); // the published matches drop off the list
}

// No screenshot and no way to get one: publish the score on its own. No player stat lines are saved
// (everyone's totals stay as they are, as if they scored 0 here) and the match says "No stats".
async function publishNoStats(root, it) {
  const msg = root.querySelector('.sl-msg');
  const { b, f, result } = it;
  const { id, statsDraft, updatedAt, updatedBy, enteredAt, enteredBy, ...keep } = result;
  try {
    await saveResult({
      eventId: b.event.id,
      fixture: f,
      uid: page.user.uid,
      existing: result,
      result: { ...keep, playerStats: {}, mvpPlayerId: null, statsStatus: 'reviewed', noStats: true },
    });
    refresh();
  } catch (err) {
    console.error(err);
    msg.textContent = `Couldn’t save: ${err.message}`;
  }
}

export function mount(el) {
  const root = el.querySelector('.admin-root');
  if (!root) return;
  bindAuthActions(root);
  if (!page) return;
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-all-clean]')) {
      publish(root, page.items.filter((it) => it.group === 'clean'));
      return;
    }
    const none = e.target.closest('[data-nostats]');
    if (none) {
      const it = page.items[Number(none.dataset.nostats)];
      const name = (id) => it.b.teamsById[id]?.name ?? '?';
      if (!window.confirm(`Publish ${name(it.f.homeTeamId)} v ${name(it.f.awayTeamId)} with NO player stats?\n\nThe score stays. Nobody gets stats from this match (as if they were all 0), and it shows "No stats" on the site. You can still add stats later with Edit.`)) return;
      none.disabled = true;
      publishNoStats(root, it);
      return;
    }
    const one = e.target.closest('[data-one]');
    if (!one) return;
    const it = page.items[Number(one.dataset.one)];
    const said = [...it.flags.map((x) => `🚩 ${x.text}`), ...it.problems.map((p) => `⚠️ ${p}`)];
    if (!window.confirm(`Publish these stats anyway?\n\n${said.join('\n')}`)) return;
    publish(root, [it]);
  });
}
