// "Event rules" on each event page: how matches are made and how results stay honest, written
// from that event's own settings (Rule config), so it always matches what the site actually does.
// Sections: Teams & sign-ups · Matches · Fixtures · Knockout · On the night · Results & integrity · Table.

import { esc, fmtDay, fmtTime } from '../ui.js';
import { zoneLabel } from '../rules/events.js';
import { groupCount } from '../rules/autofix.js';
import { flowOf } from '../rules/flow.js';
import { DEFAULT_FORMAT, DEFAULT_STANDINGS, SQUAD_MAX } from '../rules/defaults.js';

const KO = { final: { n: 2, rounds: 'a final' }, semis: { n: 4, rounds: 'semi-finals, then a final' }, quarters: { n: 8, rounds: 'quarter-finals, semi-finals, then a final' } };
const TIEBREAK = { points: 'table points', wins: 'wins', setRatio: 'set ratio', pointRatio: 'point ratio', h2h: 'head-to-head' };

export function eventRulesSections(e, { teams = 0 } = {}) {
  const fmt = { ...DEFAULT_FORMAT, ...(e.matchFormat ?? {}) };
  const size = e.teamSize ?? fmt.teamSize;
  const groups = groupCount(e);
  const auto = e.autoFixtures ?? 'off';
  const ko = KO[e.finals?.type ?? 'none'];
  const flow = flowOf(e);
  const at = (ms) => `${fmtDay(ms)} ${fmtTime(ms)} ${zoneLabel(ms)}`;
  const lock = e.date && !e.timeTbd ? e.date - 10 * 60000 : null;
  const mp = DEFAULT_STANDINGS.matchPoints;

  const sections = [];
  sections.push(['Teams & sign-ups', [
    `${size}v${size}. Club squads have up to ${SQUAD_MAX} players (${size} + ${SQUAD_MAX - size} subs); any squad player can play.`,
    e.signups ? `Club managers sign their club up on this page${lock ? `, until ${esc(at(lock))} (10 minutes before the start)` : ' until an admin locks the fixtures'}. They can pull out until then.` : 'Admins choose the teams for this event.',
    e.solos ? 'No club? Sign up solo: admins group solo players into mix teams for this event only (your club doesn’t change).' : '',
  ]]);
  sections.push(['Matches', [
    `Best of ${fmt.bestOf} sets. Every set is first to ${fmt.pointsPerSet}${fmt.decidingSetPoints !== fmt.pointsPerSet ? ` (deciding set to ${fmt.decidingSetPoints})` : ''}, win by ${fmt.winBy}${fmt.cap ? `, capped at ${fmt.cap}` : ', no cap'}.`,
    ko ? `Knockout matches: ${ko.n > 2 ? `best of ${e.finals?.semiBestOf ?? 3} before the final, ` : ''}the final is best of ${e.finals?.finalBestOf ?? 5}.` : '',
    'A forfeit counts as a 2–0 win with both sets 10–0; nobody gets stats from it.',
  ]]);
  if (auto !== 'off') {
    sections.push(['Fixtures', [
      groups > 1
        ? `Teams are drawn into ${groups} groups (${e.groups?.draw === 'manual' ? 'placed by admins' : 'a random draw that keeps groups even; admins can place teams by hand'}). Everyone plays everyone in their group ${auto === 'double' ? 'twice (home and away)' : 'once'}.`
        : `Round robin: everyone plays everyone ${auto === 'double' ? 'twice (home and away)' : 'once'}.`,
      e.signups ? 'The fixtures update by themselves as clubs sign up, then lock 10 minutes before the start. After that they don’t change.' : 'Fixtures lock when an admin locks them.',
    ]]);
  }
  if (ko) {
    sections.push(['Knockout', [
      `The top ${ko.n} go through to ${ko.rounds}.`,
      groups > 1 ? 'Group winners first, then runners-up (the best runners-up on points if not all fit). The bracket is crossed (A1 v B2) so group mates don’t meet in the first knockout round.' : (ko.n === 2 ? 'Seeded by the final table: 1st plays 2nd.' : 'Seeded by the final table: 1st plays the lowest seed.') + ' The higher seed is the home team.',
      e.finals?.thirdPlace && ko.n >= 4 ? `The semi-final losers play a 3rd place match (best of ${e.finals?.semiBestOf ?? 3}).` : '',
      'Knockout matches don’t count in the tables.',
    ]]);
  }
  if (flow) {
    sections.push(['On the night', [
      `Reporting opens at the start time${e.date && !e.timeTbd ? ` (${esc(at(e.date))})` : ''}.`,
      'Each team plays one match at a time: your next match opens as soon as both teams have finished their previous one and its score is confirmed.',
      flow.readyUp === true ? `Check in: every player checks in once for the event (✋ Check in on the event page or any of your match pages). A match starts (score reporting and the Discord match thread) once ${Number(e.flow?.readyCount) || size} players from each team have checked in. Can't do it yourself? Ask a staff member to check you in.` : '',
      ko ? (flow.breakMinutes != null ? `When the ${groups > 1 ? 'group stage' : 'round robin'} is done there’s a ${flow.breakMinutes}-minute break, then the knockout opens by itself.` : `When the ${groups > 1 ? 'group stage' : 'round robin'} is done there’s a break until an admin opens the knockout.`) : '',
      'Admins can pause the event, open matches early, or step in on any match.',
    ]]);
  }
  sections.push(['Results & integrity', [
    'Players on either team report the set scores on the match page. When a vote from each team agrees, the score goes live straight away.',
    'A captain (club manager) can confirm the other team’s score with one tap instead.',
    'Upload the full end-of-match screenshot (not cropped): admins read every player’s stats from it. Players never type stats, and a match without a screenshot can’t count stats.',
    flow ? `If the scores don’t match, or only one team reports, for ${flow.stuckMinutes} minutes, admins are called in and decide.` : 'If the scores don’t match, admins decide.',
    'Admins can correct any result. Every admin change is recorded in an audit log that can’t be edited.',
  ]]);
  if (e.showTable || groups > 1) {
    sections.push(['Table', [
      `Points: 2–0 win = ${mp['2-0']}, 2–1 win = ${mp['2-1']}, 1–2 loss = ${mp['1-2']}, 0–2 loss = ${mp['0-2']}.`,
      `Ties are split by ${DEFAULT_STANDINGS.tiebreakers.map((t) => TIEBREAK[t] ?? t).join(', then ')}.`,
    ]]);
  }
  return sections.map(([title, lines]) => [title, lines.filter(Boolean)]).filter(([, lines]) => lines.length);
}

export function eventRulesHtml(e, opts) {
  return `
    <details class="panel event-rules" open>
      <summary><h2>📜 Event rules</h2><span class="muted small">How matches are made and how results are checked</span></summary>
      <div class="er-grid">${eventRulesSections(e, opts).map(([title, lines]) => `
        <section><h3>${esc(title)}</h3><ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul></section>`).join('')}
      </div>
      <p class="muted small" style="margin:12px 0 0">These follow this event’s settings. The full FAQ &amp; rules are on the <a href="/help" data-link>FAQ &amp; rules</a> page.</p>
    </details>`;
}
