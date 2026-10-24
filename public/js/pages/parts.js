// Building blocks shared by several pages.
// A "bundle" is one event's data from data.js loadEventBundle().

import { esc, fmtDay, fmtTime, teamDot, teamLink, urls } from '../ui.js';
import { checkResult } from '../rules/match.js';
import { formatFor } from '../rules/season.js';
import { byTime } from '../rules/standings.js';
import { flowOf, matchState } from '../rules/flow.js';

export { byTime };

// Every fixture across events, as [{ b, f }] (bundle + fixture), oldest first; undated last.
export function allFixtures(bundles) {
  return bundles
    .flatMap((b) => b.fixtures.map((f) => ({ b, f })))
    .sort((x, y) => {
      const t = (x.f.scheduledAt ?? Infinity) - (y.f.scheduledAt ?? Infinity);
      if (t) return t;
      return x.b === y.b ? stageOrder(x.f, y.f) : byTime(x.f, y.f);
    });
}

// Within one event: other matches, then the group stage group by group, then the knockout.
export function stageOrder(x, y) {
  const ko = (f) => (f.stage === 'playoffs' ? 1 : 0);
  return ko(x) - ko(y) || String(x.group ?? '').localeCompare(String(y.group ?? '')) || (x.order ?? 0) - (y.order ?? 0);
}

export function resultOf(b, f) {
  const result = b.results[f.id];
  if (!result) return { result: null, check: null };
  return { result, check: checkResult(result.sets, formatFor(b.season, f)) };
}

// One fixture as a scoreboard row, linking to its match page.
// showEvent: name the event in the row (for site-wide lists). timeOnly: list is already grouped by day.
// The fixture's label for its row: under a heading for its round or group, without repeating it.
function shortLabel(f, hideRound) {
  const label = (f.label ?? '').trim();
  if (!label) return '';
  if (!hideRound) return esc(label);
  const head = roundName(f);
  if (head === label) return '';
  if (head && label.startsWith(`${head} · `)) return esc(label.slice(head.length + 3));
  return esc(label);
}

// Where a played match's player stats are up to (forfeits have none):
//   'confirmed' = staff have checked them (they're on the match page)
//   'submitted' = an end-of-match screenshot is in, waiting for staff
//   'missing'   = no screenshot yet
export function statsState(b, f, result) {
  if (!result || result.forfeit) return null;
  if (result.statsStatus === 'reviewed' || Object.keys(result.playerStats ?? {}).length) return 'confirmed';
  const shot = (b.submissions ?? []).some((s) => s.fixtureId === f.id && s.screenshotPaths?.length)
    || (result.screenshots ?? []).length || result.statsDraft?.shot;
  return shot ? 'submitted' : 'missing';
}
const STATS_BADGE = {
  confirmed: ['✅', 'Stats confirmed', 'Staff have checked the stats'],
  submitted: ['📸', 'Stats submitted', 'Screenshot in: staff are checking the stats'],
  missing: ['⏳', 'No stats yet', 'Nobody has sent the end-of-match screenshot yet'],
};
export function statsBadge(state) {
  if (!state) return '';
  const [icon, text, title] = STATS_BADGE[state];
  return `<span class="stats-badge ${state}" title="${title}"><span aria-hidden="true">${icon}</span> ${text}</span>`;
}

// compact: inside a group card, which already says the group and round (and that it's a draft).
export function fixtureRow(b, f, { showEvent = false, timeOnly = false, href = null, hideRound = false, compact = false } = {}) {
  const home = b.teamsById[f.homeTeamId];
  const away = b.teamsById[f.awayTeamId];
  const { result, check } = resultOf(b, f);
  const played = Boolean(check?.ok);
  const homeWon = played && check.winner === 'home';
  // Finals not yet decided show "1st place", "Winner SF1"...
  const nameOf = (team, cls) => team?.name ?? (cls.includes('away') ? f.awayPlaceholder : f.homePlaceholder) ?? 'TBC';
  const side = (team, cls) => `<div class="side ${cls}${team ? '' : ' tbc'}">${cls.includes('away') ? `<span>${esc(nameOf(team, cls))}</span>${teamDot(team)}` : `${teamDot(team)}<span>${esc(nameOf(team, cls))}</span>`}</div>`;

  // Match flow: "on now" while a match is open for reporting, "up next" while its teams finish
  // an earlier one (only once the event has started).
  const st = !result && !f.virtual && flowOf(b.event) ? matchState(b, f, Date.now()) : null;
  let mid;
  if (played) mid = `<span class="score num">${check.homeSets}<i>–</i>${check.awaySets}</span>`;
  else if (result) mid = '<span class="when">Under<br>review</span>';
  else if (st?.state === 'open') mid = '<span class="when on-now"><i class="live-dot"></i>on now</span>';
  else if (st?.state === 'waiting') mid = '<span class="when up-next">up<br>next</span>';
  else if (!f.scheduledAt) mid = '<span class="when tbd">TBD</span>';
  else mid = `<span class="when">${timeOnly ? '' : `${fmtDay(f.scheduledAt)}<br>`}${f.timeTbd ? 'Time TBD' : fmtTime(f.scheduledAt)}</span>`;

  const bestOf = formatFor(b.season, f).bestOf;
  const meta = [
    showEvent ? `<b>${esc(b.event.title)}</b>` : '',
    // Under a round heading, "Round 3" would just repeat it (but "Semi-final 1" still says which one)
    compact ? '' : shortLabel(f, hideRound),
    played && !timeOnly && f.scheduledAt ? fmtDay(f.scheduledAt) : '',
    result?.forfeit ? 'Forfeit' : '',
    f.virtual && f.auto && !compact ? 'Draft: changes as clubs sign up' : '',
    bestOf !== 3 ? `Best of ${bestOf}` : '',
    played ? statsBadge(statsState(b, f, result)) : '',
  ].filter(Boolean);

  return `
    <a class="fx" href="${href ?? urls.match(b.event.id, f.id)}" data-link>
      ${side(home, `home${played && !homeWon ? ' lost' : ''}`)}
      <div class="mid">${mid}</div>
      ${side(away, `away${played && homeWon ? ' lost' : ''}`)}
      ${meta.length ? `<div class="meta">${meta.map((m) => `<span>${m}</span>`).join('')}</div>` : ''}
    </a>`;
}

// Rows grouped under day headings; undated fixtures go under "Date TBD".
// The round a fixture belongs to, from its label ("Round 3", "Semi-final 1", "Grand final"), or null.
export function roundName(f) {
  const label = (f.label ?? '').trim();
  let m = label.match(/^(round|week|matchday|game ?day)\s*(\d+)/i);
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}`;
  if (/^quarter[- ]?finals?\b/i.test(label)) return 'Quarter-finals';
  if (/^semi[- ]?finals?\b/i.test(label)) return 'Semi-finals';
  if (/^grand[- ]?finals?\b/i.test(label)) return 'Grand final';
  if (/^finals?\b/i.test(label)) return 'Final';
  m = label.match(/^(group\s+\w+)/i);
  if (m) return m[1].replace(/^group/i, 'Group');
  return null;
}

// Fixtures with a heading for each round (from the labels). Fixtures without a round label
// are grouped by day instead. showEvent: each heading also names the event.
export function fixturesByRound(items, { showEvent = false, ...rowOptions } = {}) {
  let last = null;
  return items.map(({ b, f }) => {
    const round = roundName(f);
    const day = f.scheduledAt ? fmtDay(f.scheduledAt) : 'Date TBD';
    const key = round ? `${b.event.id}|${round}` : `day|${day}|${showEvent ? b.event.id : ''}`;
    const head = key !== last
      ? `<div class="day-head round-head"><span>${esc(round ?? day)}</span>${showEvent ? `<small>${esc(b.event.title)}</small>` : ''}</div>`
      : '';
    last = key;
    // Under a round heading the row shows its own date; under a day heading just the time.
    return head + fixtureRow(b, f, { ...rowOptions, showEvent: false, timeOnly: !round && Boolean(f.scheduledAt), hideRound: Boolean(round) });
  }).join('');
}

export function fixturesByDay(items, rowOptions = {}) {
  let last = null;
  return items.map(({ b, f }) => {
    const label = f.scheduledAt ? fmtDay(f.scheduledAt) : 'Date TBD';
    const head = label !== last ? `<div class="day-head">${esc(label)}</div>` : '';
    last = label;
    return head + fixtureRow(b, f, { ...rowOptions, timeOnly: Boolean(f.scheduledAt) });
  }).join('');
}

// Column headers for the stats (PTS, SPK, ...), with full names on hover.
export function statHeads(statDefs) {
  return statDefs.map((s) => `<th title="${esc(s.name)}">${esc(s.label)}</th>`).join('');
}

export function statCells(values, statDefs, fmt = (n) => n) {
  return statDefs.map((s) => `<td>${fmt(values?.[s.key] ?? 0)}</td>`).join('');
}

// Event table (round-robin style), from computeStandings() rows.
export function standingsTable(rows, b) {
  const body = rows.map((r) => `
    <tr>
      <td class="first"><span class="rank">${r.rank}</span>${teamLink(b.teamsById[r.teamId] ?? { id: r.teamId, name: r.name })}</td>
      <td>${r.played}</td><td>${r.wins}</td><td>${r.losses}</td><td class="strong">${r.points}</td>
      <td>${r.setsWon}–${r.setsLost}</td><td>${r.pointsWon}–${r.pointsLost}</td>
    </tr>`).join('');
  return `
    <div class="table-wrap"><table class="data">
      <thead><tr><th class="first">Team</th><th title="Played">P</th><th title="Won">W</th><th title="Lost">L</th><th title="Table points">Pts</th><th>Sets</th><th>Points</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
}

// ---------- Group stage and finals (event page) ----------

const placeName = (p) => (p === 1 ? 'winner' : p === 2 ? 'runner-up' : `${p}${p === 3 ? 'rd' : 'th'}-placed team`);

// "Top 2 go through." / "The group winner goes through, plus the best runner-up across the groups."
export function throughNote(places) {
  if (!places) return '';
  const lead = places.direct === 0 ? '' : places.direct === 1 ? 'Group winners go through' : `Top ${places.direct} in each group go through`;
  const extra = places.best ? `the best ${places.bestCount > 1 ? `${places.bestCount} ` : ''}${placeName(places.best)}${places.bestCount > 1 ? 's' : ''} across the groups` : '';
  return lead && extra ? `${lead}, plus ${extra}.` : lead ? `${lead}.` : extra ? `Only ${extra} go through.` : '';
}

// Column width by group count, so the cards fill rows evenly (4 groups → 2 × 2, 3 → 3 across).
const gridMin = (n) => (n <= 3 ? 260 : n === 4 || n >= 7 ? 360 : 300);

// One table card per group: big letter, P W L Pts and sets, places that go through highlighted.
export function groupTablesHtml(b) {
  const { groups, tables, places } = b.plan;
  const mark = (rank) => (places && rank <= places.direct ? 'through' : places?.best === rank ? 'maybe' : '');
  const cards = Object.keys(groups).map((l) => {
    const t = tables[l];
    const rows = t?.rows ?? [];
    return `
      <section class="gt-card">
        <header class="gt-head">
          <span class="gt-letter">${l}</span>
          <span class="gt-title"><b>Group ${l}</b><small>${groups[l].length} team${groups[l].length === 1 ? '' : 's'}</small></span>
          ${t?.done ? '<span class="gt-done">✓ Finished</span>' : ''}
        </header>
        ${rows.length ? `
        <table class="gt-table">
          <thead><tr><th class="gt-rank">#</th><th class="gt-team">Team</th><th title="Played">P</th><th title="Won">W</th><th title="Lost">L</th><th title="Sets won–lost">Sets</th><th title="Table points">Pts</th></tr></thead>
          <tbody>${rows.map((r) => {
            const team = b.teamsById[r.teamId] ?? { id: r.teamId, name: r.name };
            return `<tr class="${mark(r.rank)}">
              <td class="gt-rank">${r.rank}</td>
              <td class="gt-team">${teamLink(team)}</td>
              <td>${r.played}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.setsWon}–${r.setsLost}</td><td class="gt-pts">${r.points}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>` : '<p class="muted" style="padding:14px 16px;margin:0">No teams yet.</p>'}
      </section>`;
  }).join('');
  const note = throughNote(places);
  return `
    <div class="gt-grid" style="--gt-min:${gridMin(Object.keys(groups).length)}px">${cards}</div>
    ${note ? `<p class="gt-key"><span class="gt-swatch through"></span> ${esc(note)}${places?.best ? ' <span class="gt-swatch maybe"></span> could go through as a best ' + esc(placeName(places.best)) + '.' : ''}</p>` : ''}`;
}

// One fixtures panel per group, with round headings. only: a Set of fixture ids to show (e.g. just
// upcoming ones); groups with none of them are left out.
export function groupFixturesHtml(b, { only = null } = {}) {
  const { groups } = b.plan;
  const all = b.fixtures.filter((f) => f.group && (!only || only.has(f.id))).sort(stageOrder);
  const letters = Object.keys(groups).filter((l) => !only || all.some((f) => f.group === l));
  return `<div class="gf-grid">${letters.map((l) => {
    let lastRound = null;
    const rows = all.filter((f) => f.group === l).map((f) => {
      const round = (f.label ?? '').split(' · ')[1] ?? null;
      const head = round && round !== lastRound ? `<div class="day-head">${esc(round)}</div>` : '';
      lastRound = round;
      return head + fixtureRow(b, f, { hideRound: true, compact: true, timeOnly: true });
    }).join('');
    return `
      <section class="panel flush gf-card">
        <header class="gf-head"><span class="gt-letter sm">${l}</span><b>Group ${l} fixtures</b></header>
        <div class="fixtures">${rows || '<p class="muted" style="padding:12px 16px;margin:0">Fixtures appear here once the group has teams.</p>'}</div>
      </section>`;
  }).join('')}</div>`;
}

// ---------- Finals bracket ----------

const slotOf = (f) => f.finalSlot ?? String(f.id).replace(/^finals-/, '');

function bracketMatch(b, f, { big = false } = {}) {
  if (!f) return '<div class="br-match empty"></div>';
  const { result, check } = resultOf(b, f);
  const played = Boolean(check?.ok);
  const bestOf = formatFor(b.season, f).bestOf;
  const side = (teamId, placeholder, sets, won) => {
    const t = b.teamsById[teamId];
    return `<div class="br-team${t ? '' : ' tbc'}${played ? (won ? ' won' : ' lost') : ''}">
      ${t ? teamDot(t, big ? 'lg' : '') : '<i class="dot"></i>'}<span class="br-name">${esc(t?.name ?? placeholder ?? 'TBC')}</span>
      ${played ? `<b class="br-sets num">${sets}</b>` : ''}
    </div>`;
  };
  const when = result && !played ? 'Result being checked'
    : !played && f.scheduledAt ? `${fmtDay(f.scheduledAt)}${f.timeTbd ? '' : ` · ${fmtTime(f.scheduledAt)}`}` : '';
  return `
    <a class="br-match${big ? ' br-final' : ''}${f.virtual ? ' draft' : ''}" href="${urls.match(b.event.id, f.id)}" data-link>
      <span class="br-label">${esc(f.label ?? '')}<span>Best of ${bestOf}</span></span>
      ${side(f.homeTeamId, f.homePlaceholder, check?.homeSets, check?.winner === 'home')}
      ${side(f.awayTeamId, f.awayPlaceholder, check?.awaySets, check?.winner === 'away')}
      ${when ? `<span class="br-when">${esc(when)}</span>` : ''}
    </a>`;
}

// The knockout as a bracket: quarter-finals → semi-finals → final (whichever this event has).
export function bracketHtml(b) {
  const ko = b.fixtures.filter((f) => f.stage === 'playoffs');
  if (!ko.length) return '';
  const bySlot = Object.fromEntries(ko.map((f) => [slotOf(f), f]));
  const rounds = [];
  if (['qf1', 'qf2', 'qf3', 'qf4'].some((s) => bySlot[s])) rounds.push({ name: 'Quarter-finals', slots: ['qf1', 'qf2', 'qf3', 'qf4'] });
  if (['sf1', 'sf2'].some((s) => bySlot[s])) rounds.push({ name: 'Semi-finals', slots: ['sf1', 'sf2'] });
  const final = bySlot.final;
  // Knockout matches outside the usual slots (added by hand) are listed after the bracket.
  const known = new Set(['qf1', 'qf2', 'qf3', 'qf4', 'sf1', 'sf2', 'final']);
  const extra = ko.filter((f) => !known.has(slotOf(f)));
  const { check } = final ? resultOf(b, final) : {};
  const champion = check?.ok ? b.teamsById[check.winner === 'home' ? final.homeTeamId : final.awayTeamId] : null;
  return `
    <div class="bracket">
      ${rounds.map((r) => `
        <div class="br-col">
          <h3 class="br-round">${r.name}</h3>
          <div class="br-matches">${r.slots.map((s) => bracketMatch(b, bySlot[s])).join('')}</div>
        </div>`).join('')}
      ${final ? `
        <div class="br-col br-col-final">
          <h3 class="br-round">${esc(final.label ?? 'Final')}</h3>
          <div class="br-matches">
            <div class="br-trophy" aria-hidden="true">🏆</div>
            ${bracketMatch(b, final, { big: true })}
            ${champion ? `<div class="br-champion">Champions<b>${teamDot(champion, 'lg')}${esc(champion.name)}</b></div>` : ''}
          </div>
        </div>` : ''}
    </div>
    ${extra.length ? `<div class="panel flush fixtures" style="margin-top:14px">${extra.map((f) => fixtureRow(b, f)).join('')}</div>` : ''}`;
}

// ---------- Seeding map (Fixtures page, bracket view) ----------
// Each first-round knockout match with the two places that feed it, and who's in each place now.
export function seedingMapHtml(b, map) {
  if (!map) return '';
  const seedLine = (i) => {
    const s = map.seeds[i];
    const t = s.teamId ? b.teamsById[s.teamId] : null;
    const status = !t ? '<span class="sm-status tbd">TBD</span>'
      : s.confirmed ? '<span class="sm-status ok">✓ Confirmed</span>' : '<span class="sm-status proj">Projected</span>';
    return `
      <div class="sm-seed">
        <span class="sm-num">${s.seed}</span>
        <span class="sm-place">${esc(s.label)}</span>
        <span class="sm-team">${t ? `${teamDot(t)}<span>${esc(t.name)}</span>` : '<span class="muted">—</span>'}</span>
        ${status}
      </div>`;
  };
  return `
    <div class="sm-grid">${map.first.map((m) => `
      <div class="sm-match">
        <div class="sm-label">${esc(m.label)}</div>
        ${seedLine(m.home)}
        <div class="sm-vs">v</div>
        ${seedLine(m.away)}
      </div>`).join('')}</div>
    <p class="gt-key">Projected = where they’d be if the groups ended now. Confirmed once their group is finished.</p>`;
}
