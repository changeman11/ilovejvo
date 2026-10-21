// Building blocks shared by several pages.

import { esc, fmtDay, fmtTime, fmtRatio, teamChip, teamLink, formPills, urls } from '../ui.js';
import { checkResult } from '../rules/match.js';

// One match line, linking to the match page: finished (score + sets) or upcoming (date/time).
// timeOnly: drop the date (for lists already grouped under a day heading).
// href: link somewhere other than the public match page (admin uses this).
export function matchRow(fixture, data, { showRound = false, timeOnly = false, href = null } = {}) {
  const home = data.teamsById[fixture.homeTeamId];
  const away = data.teamsById[fixture.awayTeamId];
  const result = data.results[fixture.id];
  const check = result ? checkResult(result.sets, data.season.format) : null;
  href ??= urls.match(data.season.id, fixture.id);
  const name = (t) => esc(t?.name ?? 'TBC');
  const round = showRound ? `<div class="sets">Round ${esc(fixture.round)} · ${fmtDay(fixture.scheduledAt)}</div>` : '';

  if (check?.ok) {
    const homeWon = check.winner === 'home';
    const sets = result.forfeit
      ? `Forfeit: ${esc(data.teamsById[result.forfeit.teamId]?.name ?? 'a team')} didn’t play`
      : result.sets.map((s) => `${s.home}-${s.away}`).join(', ');
    return `
      <a class="match" href="${href}" data-link>
        <div class="side home ${homeWon ? 'won' : 'lost'}">${teamChip(home)}<span>${name(home)}</span></div>
        <div class="score num">${check.homeSets}–${check.awaySets}</div>
        <div class="side away ${homeWon ? 'lost' : 'won'}"><span>${name(away)}</span>${teamChip(away)}</div>
        <div class="sets num">${sets}</div>
        ${round}
      </a>`;
  }
  const middle = result
    ? '<div class="when">Result<br>under review</div>'
    : timeOnly
      ? `<div class="when"><b>${fmtTime(fixture.scheduledAt) || 'TBC'}</b></div>`
      : `<div class="when">${fmtDay(fixture.scheduledAt)}<br>${fmtTime(fixture.scheduledAt)}</div>`;
  return `
    <a class="match" href="${href}" data-link>
      <div class="side home">${teamChip(home)}<span>${name(home)}</span></div>
      ${middle}
      <div class="side away"><span>${name(away)}</span>${teamChip(away)}</div>
      ${showRound ? `<div class="sets">Round ${esc(fixture.round)}</div>` : ''}
    </a>`;
}

// Season dropdown. Only shown when there's more than one season.
// `path` is the page to reload with ?season=<id>.
export function seasonPicker(data, path) {
  if (!data.seasons || data.seasons.length < 2) return '';
  const options = [...data.seasons]
    .reverse()
    .map((s) => {
      const selected = s.id === data.season.id ? ' selected' : '';
      return `<option value="${esc(path)}?season=${encodeURIComponent(s.id)}"${selected}>${esc(s.name)}</option>`;
    })
    .join('');
  return `<label class="picker"><span class="sr-only">Season</span><select data-nav>${options}</select></label>`;
}

// The band (playoffs, premiers...) a table position falls in. Narrowest band wins.
function bandFor(rank, bands = []) {
  return bands
    .filter((b) => rank >= b.from && rank <= b.to)
    .sort((a, b) => a.to - a.from - (b.to - b.from))[0];
}

// Standings table. `compact` shows fewer columns for the home page.
export function standingsTable(rows, data, { compact = false, highlight = null } = {}) {
  const bands = data.season.bands ?? [];
  const head = compact
    ? '<th class="team-col">Team</th><th>P</th><th>W</th><th>L</th><th>Pts</th><th class="col-form">Form</th>'
    : `<th class="team-col">Team</th><th title="Played">P</th><th title="Won">W</th><th title="Lost">L</th>
       <th title="Table points">Pts</th><th title="Sets won–lost">Sets</th><th title="Set ratio">SR</th>
       <th title="Points won–lost">Points</th><th title="Point ratio">PR</th><th>Form</th>`;

  const body = rows
    .map((r) => {
      const team = data.teamsById[r.teamId];
      const band = bandFor(r.rank, bands);
      const cls = [band ? `band-${esc(band.tone ?? 'accent')}` : '', r.teamId === highlight ? 'is-highlight' : ''].join(' ');
      const teamCell = `<td class="team-col"><span class="rank num">${r.rank}</span>${teamLink(team)}</td>`;
      const cells = compact
        ? `<td class="num">${r.played}</td><td class="num">${r.wins}</td><td class="num">${r.losses}</td><td class="num pts">${r.points}</td><td class="col-form">${formPills(r.form)}</td>`
        : `<td class="num">${r.played}</td><td class="num">${r.wins}</td><td class="num">${r.losses}</td>
           <td class="num pts">${r.points}</td><td class="num">${r.setsWon}–${r.setsLost}</td><td class="num">${fmtRatio(r.setRatio)}</td>
           <td class="num">${r.pointsWon}–${r.pointsLost}</td><td class="num">${fmtRatio(r.pointRatio)}</td><td>${formPills(r.form)}</td>`;
      return `<tr class="${cls.trim()}">${teamCell}${cells}</tr>`;
    })
    .join('');

  const legendBands = [...new Map(bands.map((b) => [b.label, b])).values()];
  const legend = legendBands.length
    ? `<div class="legend">${legendBands
        .map((b) => `<span style="--c: var(--${b.tone === 'gold' ? 'gold' : 'accent-2'})">${esc(b.label)}</span>`)
        .join('')}</div>`
    : '';

  return `<div class="table-wrap"><table class="data${compact ? ' compact' : ''}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${compact ? '' : legend}`;
}

// Column headers for the season's stats (PTS, SPK, ...), with full names on hover.
export function statHeads(statDefs) {
  return statDefs.map((s) => `<th title="${esc(s.name)}">${esc(s.label)}</th>`).join('');
}

export function statCells(values, statDefs, fmt = (n) => n) {
  return statDefs.map((s) => `<td class="num">${fmt(values?.[s.key] ?? 0)}</td>`).join('');
}

// Group fixtures by calendar day, keeping order. Returns [{ label, fixtures }]
export function byDay(fixtures) {
  const groups = [];
  for (const f of fixtures) {
    const label = fmtDay(f.scheduledAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.fixtures.push(f);
    else groups.push({ label, fixtures: [f] });
  }
  return groups;
}

export const sortByTime = (a, b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0) || (a.round ?? 0) - (b.round ?? 0);
