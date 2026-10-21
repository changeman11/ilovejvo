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
    .sort((x, y) => byTime(x.f, y.f));
}

export function resultOf(b, f) {
  const result = b.results[f.id];
  if (!result) return { result: null, check: null };
  return { result, check: checkResult(result.sets, formatFor(b.season, f)) };
}

// One fixture as a scoreboard row, linking to its match page.
// showEvent: name the event in the row (for site-wide lists). timeOnly: list is already grouped by day.
export function fixtureRow(b, f, { showEvent = false, timeOnly = false, href = null } = {}) {
  const home = b.teamsById[f.homeTeamId];
  const away = b.teamsById[f.awayTeamId];
  const { result, check } = resultOf(b, f);
  const played = Boolean(check?.ok);
  const homeWon = played && check.winner === 'home';
  const side = (team, cls) => `<div class="side ${cls}">${cls.includes('away') ? `<span>${esc(team?.name ?? 'TBC')}</span>${teamDot(team)}` : `${teamDot(team)}<span>${esc(team?.name ?? 'TBC')}</span>`}</div>`;

  let mid;
  if (played) mid = `<span class="score num">${check.homeSets}<i>–</i>${check.awaySets}</span>`;
  else if (result) mid = '<span class="when">Under<br>review</span>';
  else if (!f.scheduledAt) mid = '<span class="when tbd">TBD</span>';
  else mid = `<span class="when">${timeOnly ? '' : `${fmtDay(f.scheduledAt)}<br>`}${f.timeTbd ? 'Time TBD' : fmtTime(f.scheduledAt)}</span>`;

  const bestOf = formatFor(b.season, f).bestOf;
  const meta = [
    showEvent ? `<b>${esc(b.event.title)}</b>` : '',
    f.label ? esc(f.label) : '',
    played && !timeOnly && f.scheduledAt ? fmtDay(f.scheduledAt) : '',
    result?.forfeit ? 'Forfeit' : '',
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
