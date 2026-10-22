// Admin inbox: team registrations, leave requests and profile claims.

import { loadRequests, loadAllBundles } from '../../data.js';
import { decideTeam, decideLeave, decideClaim } from '../../admin-data.js';
import { refresh } from '../../nav.js';
import { esc, skeleton, teamDot, playerLink, fmtDay, urls } from '../../ui.js';
import { tallyVotes, voteLabel } from '../../rules/votes.js';
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
  page = { user: gate.user, r };

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
      <span class="row-side"><a class="btn btn-sm btn-primary" href="${urls.adminResult(b.event.id, f.id)}" data-link>Check stats</a></span>
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
  const empty = (text) => `<p class="muted" style="padding:16px">${text}</p>`;

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
        <span class="muted small">${esc(when(l.createdAt))}${l.reason ? ` · “${esc(l.reason)}”` : ''}</span></span>
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
        <div class="page-head"><div><h1>Requests</h1><p class="muted">Things players are waiting on.</p></div></div>
        <div class="stack">
          <section><div class="section-head"><h2>Stats to check</h2></div><div class="panel flush rows">${statsRows || empty('Nothing waiting. Matches appear here once both teams agree on the score.')}</div>
            <p class="muted small" style="margin-top:6px">The score is already live. Open one, press “Read stats” on a screenshot, check names and numbers, then save.</p></section>
          <section><div class="section-head"><h2>Scores the teams disagree on</h2></div><div class="panel flush rows">${disputeRows || empty('No disagreements. Scores both teams agree on go live by themselves.')}</div>
            <p class="muted small" style="margin-top:6px">Open one to see each team’s vote and screenshots, then enter the right score.</p></section>
          <section><div class="section-head"><h2>New teams</h2></div><div class="panel flush rows">${teams || empty('No team registrations waiting.')}</div>
            <p class="muted small" style="margin-top:6px">Approving makes the person who registered it the manager.</p></section>
          <section><div class="section-head"><h2>Leave requests</h2></div><div class="panel flush rows">${leaves || empty('No leave requests waiting.')}</div>
            <p class="muted small" style="margin-top:6px">Approving makes the player a free agent. If they were the manager, pick a new one under Teams &amp; players.</p></section>
          <section><div class="section-head"><h2>Profile claims</h2></div><div class="panel flush rows">${claims || empty('No claims waiting.')}</div>
            <p class="muted small" style="margin-top:6px">Check on Discord that it’s really them before approving: they get that profile’s stats.</p></section>
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
