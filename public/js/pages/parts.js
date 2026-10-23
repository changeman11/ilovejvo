// Building blocks shared by several pages.
// A "bundle" is one event's data from data.js loadEventBundle().

import { esc, fmtDay, fmtTime, teamDot, teamLink, urls } from '../ui.js';
import { checkResult } from '../rules/match.js';
import { formatFor } from '../rules/season.js';
import { byTime } from '../rules/standings.js';

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

  let mid;
  if (played) mid = `<span class="score num">${check.homeSets}<i>–</i>${check.awaySets}</span>`;
  else if (result) mid = '<span class="when">Under<br>review</span>';
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

// ---------- Group stage (event page) ----------

// A small table for one group: place, team, P, W, L, Pts, sets. Places that go through are marked.
export function groupTable(rows, b, places) {
  const mark = (rank) => (places && rank <= places.direct ? ' through' : places?.best === rank ? ' maybe' : '');
  return `
    <div class="table-wrap"><table class="data group-table">
      <thead><tr><th class="first">Team</th><th title="Played">P</th><th title="Won">W</th><th title="Lost">L</th><th title="Table points">Pts</th><th>Sets</th></tr></thead>
      <tbody>${rows.map((r) => `
        <tr class="${mark(r.rank).trim()}">
          <td class="first"><span class="rank">${r.rank}</span>${teamLink(b.teamsById[r.teamId] ?? { id: r.teamId, name: r.name })}</td>
          <td>${r.played}</td><td>${r.wins}</td><td>${r.losses}</td><td class="strong">${r.points}</td><td>${r.setsWon}–${r.setsLost}</td>
        </tr>`).join('')}</tbody>
    </table></div>`;
}

const placeName = (p) => (p === 1 ? 'winner' : p === 2 ? 'runner-up' : `${p}${p === 3 ? 'rd' : 'th'}-placed team`);

// One card per group: table, who goes through, and the group's fixtures under round headings.
export function groupCards(b) {
  const { groups, tables, places } = b.plan;
  const fixtures = b.fixtures.filter((f) => f.group);
  // "Top 2 go through." / "The group winner goes through, plus the best runner-up across the groups."
  let note = '';
  if (places) {
    const lead = places.direct === 0 ? '' : places.direct === 1 ? 'The group winner goes through' : `Top ${places.direct} go through`;
    const extra = places.best ? `the best ${places.bestCount > 1 ? `${places.bestCount} ` : ''}${placeName(places.best)}${places.bestCount > 1 ? 's' : ''} across the groups` : '';
    note = lead && extra ? `${lead}, plus ${extra}.` : lead ? `${lead}.` : extra ? `Only ${extra} go through.` : '';
  }
  return `<div class="group-grid">${Object.keys(groups).map((l) => {
    const t = tables[l];
    const mine = fixtures.filter((f) => f.group === l).sort(stageOrder);
    let lastRound = null;
    const rows = mine.map((f) => {
      const round = (f.label ?? '').split(' · ')[1] ?? null;
      const head = round && round !== lastRound ? `<div class="day-head">${esc(round)}</div>` : '';
      lastRound = round;
      return head + fixtureRow(b, f, { hideRound: true, compact: true, timeOnly: true });
    }).join('');
    return `
      <section class="panel flush group-card">
        <div class="group-card-head"><h3>Group ${l}</h3><span class="muted small">${groups[l].length} team${groups[l].length === 1 ? '' : 's'}</span>${t?.done ? '<span class="tag tag-live">Finished</span>' : ''}</div>
        ${t?.rows.length ? groupTable(t.rows, b, places) : '<p class="muted" style="padding:12px 16px">No teams yet.</p>'}
        ${note ? `<p class="group-note muted small">${esc(note)}</p>` : ''}
        <div class="fixtures">${rows || '<p class="muted" style="padding:12px 16px">Fixtures appear here once the group has teams.</p>'}</div>
      </section>`;
  }).join('')}</div>`;
}
