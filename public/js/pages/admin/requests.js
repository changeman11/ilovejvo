// Admin inbox: team registrations, leave requests and profile claims.

import { loadRequests, loadAllBundles } from '../../data.js';
import { decideTeam, decideLeave, decideClaim, setFixStatus } from '../../admin-data.js';
import { fixPending } from '../../rules/corrections.js';
import { refresh } from '../../nav.js';
import { esc, skeleton, teamDot, playerLink, fmtDay, urls } from '../../ui.js';
import { tallyVotes, voteLabel, sameSets } from '../../rules/votes.js';
import { adminGate, adminBar, bindAuthActions } from './gate.js';

export const title = 'Requests';

export function loading() {
  return skeleton([50, 200, 200]);
}

let page = null;

export async function render() {
  const gate = await adminGate();
  if (gate.html) return { title: 'Admin sign-in', html: `<div class="admin-root">${gate.html}</div>` };
  const [r, bundles] = await Promise.all([loadRequests(), loadAllBundles({ includeDrafts: true, fresh: true })]);
  // Players' fixes to results already in (rules/corrections.js) that still need an admin.
  const fixes = bundles.flatMap((b) => (b.corrections ?? [])
    .filter((c) => fixPending(c, b.results[c.fixtureId]))
    .map((c) => ({ b, c, f: b.fixtures.find((x) => x.id === c.fixtureId) }))
    .filter((x) => x.f));
  page = { user: gate.user, r, fixes };
  const fixRows = fixes.map(({ b, c, f }) => {
    const result = b.results[f.id];
    const asks = [
      c.sets?.length ? (sameSets(c.sets, result.sets) ? `score fixed to <b class="num">${esc(voteLabel(c.sets))}</b> (both teams agreed)` : `says it was <b class="num">${esc(voteLabel(c.sets))}</b> (now ${esc(voteLabel(result.sets))})`) : '',
      c.screenshotPaths?.length ? `${c.screenshotPaths.length} screenshot${c.screenshotPaths.length === 1 ? '' : 's'} added` : '',
      c.note ? `“${esc(c.note)}”` : '',
    ].filter(Boolean).join(' · ');
    return `
    <div class="row">
      <span class="row-main"><b>${esc(b.teamsById[f.homeTeamId]?.name ?? 'TBC')} v ${esc(b.teamsById[f.awayTeamId]?.name ?? 'TBC')}</b>
        <span class="muted small">${esc(b.event.title)} · ${esc(b.playersById[c.playerId]?.displayName ?? c.playerId)} (${esc(b.teamsById[c.teamId]?.shortName ?? '')}) ${asks}</span></span>
      <span class="row-side"><a class="btn btn-sm btn-primary" href="${urls.adminResult(b.event.id, f.id)}" data-link>Open</a>
        <button class="btn btn-sm" data-act="fix-done" data-id="${esc(c.id)}" data-event="${esc(b.event.id)}" title="Nothing to change: close it">Done</button></span>
    </div>`;
  }).join('');

  // Result votes the two teams don't agree on (no result yet): an admin decides.
  const disputes = bundles.flatMap((b) => b.fixtures
    .filter((f) => !b.results[f.id])
    .map((f) => ({ b, f, tally: tallyVotes((b.submissions ?? []).filter((s) => s.fixtureId === f.id), f) }))
    .filter((x) => x.tally.status === 'disputed'));
  // Scores that went live from players' votes, waiting for an admin to add the stats from screenshots.
  const statsToCheck = bundles.flatMap((b) => b.fixtures
    .filter((f) => b.results[f.id]?.statsStatus === 'pending')
    .map((f) => ({ b, f, shots: (b.submissions ?? []).filter((v) => v.fixtureId === f.id).reduce((n, v) => n + (v.screenshotPaths?.length ?? 0), 0) })));
  const statsRows = statsToCheck.map(({ b, f, shots }) => `
    <div class="row">
      <span class="row-main"><b>${esc(b.teamsById[f.homeTeamId]?.name ?? 'TBC')} v ${esc(b.teamsById[f.awayTeamId]?.name ?? 'TBC')}</b>
        <span class="muted small">${esc(b.event.title)} · ${shots ? `${shots} screenshot${shots === 1 ? '' : 's'} to read` : 'no screenshot yet'}</span></span>
      <span class="row-side"><a class="btn btn-sm btn-primary" href="/admin/stats" data-link>Stats list</a> <a class="btn btn-sm" href="${urls.adminResult(b.event.id, f.id)}" data-link>Edit</a></span>
    </div>`).join('');
  const disputeRows = disputes.map(({ b, f, tally }) => {
    const name = (id) => esc(b.teamsById[id]?.name ?? 'TBC');
    const says = (votes) => votes.map((v) => `${esc(b.playersById[v.playerId]?.displayName ?? v.playerId)}: ${esc(voteLabel(v.sets))}`).join(' · ');
    return `
    <div class="row">
      <span class="row-main"><b>${name(f.homeTeamId)} v ${name(f.awayTeamId)}</b>
        <span class="muted small">${esc(b.event.title)} · ${says(tally.home)} · ${says(tally.away)}</span></span>
      <span class="row-side"><a class="btn btn-sm btn-primary" href="${urls.adminResult(b.event.id, f.id)}" data-link>Decide</a></span>
    </div>`;
  }).join('');
  const nameOf = (pid) => r.playersById[pid]?.displayName ?? pid;
  const when = (ms) => (ms ? fmtDay(ms) : '');

  const teams = r.pendingTeams.map((t) => `
    <div class="row">
      <span class="row-main"><b><span class="team">${teamDot(t)}${esc(t.name)}</span></b><span class="muted small">Manager: ${esc(nameOf(t.managerPlayerId))}</span></span>
      <span class="row-side">
        <button class="btn btn-sm btn-primary" data-act="team-yes" data-id="${esc(t.id)}">Approve</button>
        <button class="btn btn-sm btn-danger" data-act="team-no" data-id="${esc(t.id)}">Reject</button>
      </span>
    </div>`).join('');

  const leaves = r.leaves.map((l) => `
    <div class="row">
      <span class="row-main"><b>${playerLink(r.playersById[l.playerId], l.playerId)} → leave ${esc(r.teamsById[l.teamId]?.name ?? l.teamId)}</b>
        <span class="muted small">${esc(when(l.createdAt))}${l.reason ? ` · “${esc(l.reason)}”` : ''}</span>
        ${r.players.some((p) => p.teamId === l.teamId && p.id !== l.playerId) ? '' : '<span class="small"><b>🏳️ Last player: approving disbands the club.</b></span>'}</span>
      <span class="row-side">
        <button class="btn btn-sm btn-primary" data-act="leave-yes" data-id="${esc(l.id)}">Approve</button>
        <button class="btn btn-sm btn-danger" data-act="leave-no" data-id="${esc(l.id)}">Decline</button>
      </span>
    </div>`).join('');

  const claims = r.claims.map((c) => {
    const own = r.players.find((p) => p.uid === c.id);
    return `
    <div class="row">
      <span class="row-main"><b>${esc(c.discordName ?? 'Discord user')} says they are ${playerLink(r.playersById[c.playerId], c.playerId)}</b>
        <span class="muted small">Discord ID ${esc(c.discordId)}${own ? ` · already has the profile “${esc(own.displayName)}”` : ''}</span></span>
      <span class="row-side">
        <button class="btn btn-sm btn-primary" data-act="claim-yes" data-id="${esc(c.id)}">Approve</button>
        <button class="btn btn-sm btn-danger" data-act="claim-no" data-id="${esc(c.id)}">Decline</button>
      </span>
    </div>`;
  }).join('');

  return {
    title: 'Requests',
    html: `
      <div class="admin-root">
        ${adminBar(gate.user, gate.admin, '/admin/requests')}
        <div class="page-head"><div><h1>📥 Requests</h1><p class="muted">Things players are waiting on.</p></div></div>
        <div class="stack">
          ${(() => {
            const n = (html) => (html.match(/class="row[ "]/g) ?? []).length;
            const blocks = [
              ['🛠', 'Result fixes', fixRows, 'Open one to use the new score. “Done” closes it without changes.'],
              ['⚖️', 'Scores the teams disagree on', disputeRows, 'Check both votes and screenshots, then enter the right score.'],
              ['🆕', 'New clubs', teams, 'Approving makes the founder the manager and sends their invites.'],
              ['🪪', 'Profile claims', claims, 'Check on Discord it’s really them: they get that profile’s stats.'],
              ['🚪', 'Leave requests', leaves, 'Approving makes the player a free agent.'],
              ['📸', 'Stats to check', statsRows, 'Quicker in bulk on the “Stats to check” page.'],
            ].filter(([, , rows]) => rows);
            if (!blocks.length) return '<p class="panel all-clear">✨ All caught up. No result fixes, disputes, new clubs, claims or leave requests waiting.</p>';
            return blocks.map(([icon, title, rows, tip]) => `
          <section>
            <div class="section-head"><h2>${icon} ${title} <span class="adm-count">${n(rows) || ''}</span></h2><span class="muted small">${tip}</span></div>
            <div class="panel flush rows">${rows}</div>
          </section>`).join('');
          })()}
          <p class="form-error" role="alert" hidden></p>
        </div>
      </div>`,
  };
}

export function mount(el) {
  const root = el.querySelector('.admin-root');
  if (!root) return;
  bindAuthActions(root);
  if (!page) return;
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const { user, r } = page;
    if (b.dataset.act === 'fix-done') {
      const hit = page.fixes.find((x) => x.c.id === b.dataset.id && x.b.event.id === b.dataset.event);
      b.disabled = true;
      try {
        await setFixStatus({ uid: user.uid, eventId: hit.b.event.id, fix: hit.c, status: 'done' });
        refresh();
      } catch (err) {
        console.error(err);
        b.disabled = false;
      }
      return;
    }
    const [kind, answer] = b.dataset.act.split('-');
    const approve = answer === 'yes';
    const id = b.dataset.id;
    b.disabled = true;
    try {
      if (kind === 'team') await decideTeam({ uid: user.uid, team: r.teamsById[id], approve });
      if (kind === 'leave') {
        const request = r.leaves.find((l) => l.id === id);
        await decideLeave({ uid: user.uid, request, approve, team: r.teamsById[request.teamId] });
      }
      if (kind === 'claim') await decideClaim({ uid: user.uid, claim: r.claims.find((c) => c.id === id), approve });
      refresh();
    } catch (err) {
      console.error(err);
      b.disabled = false;
      const box = root.querySelector('.form-error');
      box.textContent = 'Couldn’t save that. Refresh and try again.';
      box.hidden = false;
    }
  });
}
