// Teams: every team in the season with its record and roster, linking to profiles.

import { loadSeasonFromUrl } from '../data.js';
import { computeStandings } from '../rules/standings.js';
import { esc, skeleton, ordinal, teamChip, playerLink, urls } from '../ui.js';
import { seasonPicker } from './parts.js';

export const title = 'Teams';

export function loading() {
  return `<div class="grid">${skeleton([60, 200, 200, 200])}</div>`;
}

export async function render() {
  const data = await loadSeasonFromUrl();
  const { rows } = computeStandings(data);

  const cards = rows
    .map((r) => {
      const team = data.teamsById[r.teamId];
      const roster = data.rosters[r.teamId] ?? { playerIds: [] };
      const players = (roster.playerIds ?? [])
        .map((pid) => `<li>${playerLink(data.playersById[pid], pid)}${roster.captainId === pid ? ' <span class="badge" title="Captain">C</span>' : ''}</li>`)
        .join('');
      return `
        <article class="card team-card" style="--team:${esc(team?.colors?.primary ?? 'var(--accent)')}">
          <a class="team-card-head" href="${urls.team(r.teamId)}" data-link>
            ${teamChip(team, 'xl')}
            <span><b>${esc(team?.name)}</b><small class="muted">${ordinal(r.rank)} ·${r.wins}W ${r.losses}L · ${r.points} pts</small></span>
          </a>
          <ul class="roster-list">${players || '<li class="muted">No roster yet</li>'}</ul>
        </article>`;
    })
    .join('');

  return `
    <section class="hero hero-row">
      <div>
        <span class="eyebrow">${esc(data.season.name)}</span>
        <h1>Teams</h1>
      </div>
      ${seasonPicker(data, '/teams')}
    </section>
    <div class="team-grid">${cards}</div>`;
}
