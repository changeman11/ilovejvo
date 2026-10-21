// Every approved team, with logo, tagline, squad size and record.

import { loadAllBundles, loadPeople, isApprovedTeam } from '../data.js';
import { esc, skeleton, notice, pageTitle, urls } from '../ui.js';
import { mediaUrl } from '../media.js';
import { seasonMatches } from '../rules/season.js';
import { teamCareer, teamXp, levelFor } from '../rules/badges.js';

export const title = 'Teams';

export function loading() {
  return skeleton([80, 260]);
}

export async function render() {
  const [bundles, people] = await Promise.all([loadAllBundles(), loadPeople()]);
  const teams = people.teams.filter(isApprovedTeam).sort((a, b) => a.name.localeCompare(b.name));
  const records = teamCareer(bundles.map((b) => ({ eventId: b.event.id, matches: seasonMatches(b).matches })));
  const head = `<div class="page-head">${pageTitle('Teams', 'Every team in JVO. Tap one for its profile.', 'knight')}</div>`;
  if (!teams.length) return { title: 'Teams', html: `${head}${notice('No teams yet', ' Teams appear here once an admin approves them.', '55')}` };

  const cards = teams.map((t) => {
    const r = records.get(t.id);
    const squad = people.players.filter((p) => p.teamId === t.id).length;
    const logo = mediaUrl(t.logoPath);
    const banner = mediaUrl(t.bannerPath);
    return `
      <a class="panel team-card" href="${urls.team(t.id)}" data-link style="--theme:${esc(t.theme ?? t.colors?.primary ?? '#1438d8')}">
        <div class="tc-banner">${banner ? `<img src="${esc(banner)}" alt="" loading="lazy" decoding="async">` : ''}</div>
        <div class="tc-body">
          ${logo ? `<img class="tc-logo" src="${esc(logo)}" alt="" loading="lazy" decoding="async">`
            : `<span class="tc-logo mono" style="background:${esc(t.colors?.primary ?? '#ffffff')}">${esc((t.shortName ?? t.name).slice(0, 4))}</span>`}
          <div class="tc-text">
            <h3>${esc(t.name)}</h3>
            ${t.tagline ? `<p class="tc-tag">${esc(t.tagline)}</p>` : ''}
            <p class="muted small">${squad} player${squad === 1 ? '' : 's'}${r ? ` · ${r.wins}–${r.losses} · level ${levelFor(teamXp(r)).level}` : ''}</p>
          </div>
        </div>
      </a>`;
  }).join('');
  return { title: 'Teams', html: `${head}<div class="team-grid">${cards}</div>` };
}
