// My matches (/matches): every match of the signed-in player's club, in one place, for players and
// managers. "Report now" = matches open for a score vote; "Needs a fix?" = results already in
// (often from Discord) where a screenshot is missing or the other team sent a fix; then the rest.
// Each row opens the match page, where the vote form or "Fix this result" is.

import { currentUser } from '../auth.js';
import { loadMe, isApprovedTeam, loadAllBundles } from '../data.js';
import { esc, skeleton, notice, teamDot } from '../ui.js';
import { fixtureRow, statsState, resultOf } from './parts.js';
import { matchesToReport } from './report.js';
import { fixesFor, fixesToAgree } from '../rules/corrections.js';
import { matchState } from '../rules/flow.js';

export const title = 'My matches';

export function loading() {
  return skeleton([80, 240, 240]);
}

const withTag = (row, tags) => row.replace('<div class="mid">', `<div class="mid">${tags}`);
const fixHref = (b, f) => `/match/${encodeURIComponent(b.event.id)}/${encodeURIComponent(f.id)}#fix`;

export async function render() {
  const user = await currentUser().catch(() => null);
  if (!user) {
    return { title: 'My matches', html: notice('Sign in first', ' Sign in with Discord on the <a href="/me" data-link>Me page</a> to see your club’s matches.') };
  }
  const me = await loadMe(user.uid);
  const team = me.team;
  if (!me.player || !isApprovedTeam(team)) {
    return { title: 'My matches', html: notice('No club yet', ' Join or start a club in the <a href="/club" data-link>Club hub</a>, and your matches show up here.') };
  }
  const captain = team.managerUid === user.uid;
  const bundles = (await loadAllBundles().catch(() => [])).filter((b) => b.event.status !== 'cancelled');
  const ours = (f) => f.homeTeamId === team.id || f.awayTeamId === team.id;

  // 1. Open for a score vote now.
  const toReport = matchesToReport(bundles, me.player);
  const reportRows = toReport.map(({ b, f, voted, ready }) => withTag(fixtureRow(b, f, { showEvent: true }),
    ready ? '<span class="tag tag-draft">waiting for check-ins</span>' : voted ? '<span class="tag tag-live">voted</span>' : '<span class="tag tag-draft">vote</span>')).join('');

  // 2. Results in: anything that needs a hand (no screenshot, fixes waiting).
  const played = bundles.flatMap((b) => b.fixtures.filter((f) => !f.virtual && ours(f) && b.results[f.id])
    .map((f) => ({ b, f, result: b.results[f.id] })))
    .filter(({ b, f }) => resultOf(b, f).check?.ok)
    .sort((x, y) => (y.f.scheduledAt ?? y.result.enteredAt ?? 0) - (x.f.scheduledAt ?? x.result.enteredAt ?? 0));
  const needs = [];
  const rest = [];
  for (const m of played) {
    const { b, f, result } = m;
    if (result.forfeit) { rest.push(m); continue; }
    const fixes = fixesFor(b.corrections, f, result);
    const agree = fixesToAgree({ corrections: b.corrections, fixture: f, result, teamId: team.id });
    const mine = (b.corrections ?? []).some((c) => c.id === `${f.id}__${me.player.id}`);
    const tags = [
      agree.length ? '<span class="tag tag-draft">other team sent a fix</span>' : '',
      statsState(b, f, result) === 'missing' ? '<span class="tag tag-draft">add screenshot</span>' : '',
      fixes.pending.length && !agree.length ? `<span class="tag">${mine ? 'your fix sent' : 'fix sent'}</span>` : '',
    ].filter(Boolean).join('');
    (tags ? needs : rest).push({ ...m, tags });
  }
  const needRows = needs.map(({ b, f, tags }) => withTag(fixtureRow(b, f, { showEvent: true, href: fixHref(b, f) }), tags)).join('');
  const restRows = rest.slice(0, 20).map(({ b, f }) => fixtureRow(b, f, { showEvent: true, href: fixHref(b, f) })).join('');

  // 3. Still to play (not open yet).
  const reportIds = new Set(toReport.map(({ f }) => f.id));
  const upcoming = bundles.flatMap((b) => b.fixtures.filter((f) => ours(f) && !b.results[f.id] && !reportIds.has(f.id))
    .map((f) => ({ b, f, st: f.virtual ? null : matchState(b, f, Date.now()) })))
    .sort((x, y) => (x.f.scheduledAt ?? Infinity) - (y.f.scheduledAt ?? Infinity) || (x.f.order ?? 0) - (y.f.order ?? 0));
  const upRows = upcoming.slice(0, 20).map(({ b, f }) => fixtureRow(b, f, { showEvent: true })).join('');

  const section = (heading, hint, rows, empty) => `
    <section>
      <div class="section-head"><h2>${heading}</h2>${hint ? `<span class="muted small">${hint}</span>` : ''}</div>
      <div class="panel flush fixtures">${rows || `<p class="muted" style="padding:14px 16px;margin:0">${empty}</p>`}</div>
    </section>`;

  return {
    title: 'My matches',
    html: `
      <div class="page-head"><div><h1>My matches</h1>
        <p class="muted">${teamDot(team)} ${esc(team.name)}${captain ? ' · you’re the captain' : ''}. Report scores, add a missing screenshot, or fix a result that went in wrong on Discord.</p></div></div>
      <div class="stack">
        <div class="panel how-to small">
          <b>How it works</b>
          <ol>
            <li><b>Report:</b> open a match under “Report now” and enter the set scores. When someone from the other team enters the same, the score goes live.</li>
            <li><b>Fix:</b> wrong score or forgot the screenshot? Open the match and press <b>🛠 Fix this result</b>. If both teams send the same new score, it changes straight away; anything else goes to the admins.</li>
          </ol>
        </div>
        ${section('🏐 Report now', 'Tap a match to vote', reportRows, 'Nothing to report right now. Matches show up here when they open.')}
        ${needs.length ? section('🛠 Needs a fix?', 'Tap to fix or add a screenshot', needRows, '') : ''}
        ${section('📅 Still to play', '', upRows, 'No more matches scheduled.')}
        ${section('✅ Results in', 'Tap one to fix it if it’s wrong', restRows, 'No results yet.')}
      </div>`,
  };
}
