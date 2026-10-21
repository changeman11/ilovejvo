// Playoff bracket drawing, shared by the Playoffs page, the home page and admin.
// Before an admin creates the bracket, shows the "if the season ended today" picture.

import { computeStandings } from '../rules/standings.js';
import { resolveBracket, projectedSeeds, bracketTemplate } from '../rules/playoffs.js';
import { formatFor } from '../rules/season.js';
import { DEFAULT_PLAYOFFS } from '../rules/defaults.js';
import { esc, fmtDay, fmtTime, teamChip, urls } from '../ui.js';

function teamLine(data, teamId, seed, setsWon, state) {
  const team = data.teamsById[teamId];
  return `
    <div class="bm-team ${state}">
      <span class="seed">${seed ?? ''}</span>
      ${team ? teamChip(team) : '<i class="chip"></i>'}
      <span class="bm-name">${esc(team?.name ?? 'TBC')}</span>
      <b class="num">${setsWon ?? ''}</b>
    </div>`;
}

function slotCard(data, slot) {
  const f = slot.fixture;
  const played = slot.played;
  // Sets won, matched to the displayed home/away (which may differ from fixture order before play).
  const sets = (teamId) => {
    if (!played) return null;
    return teamId === f.homeTeamId ? slot.check.homeSets : slot.check.awaySets;
  };
  const state = (teamId) => (!played ? '' : teamId === slot.winnerTeamId ? 'won' : 'lost');
  const bestOf = f ? formatFor(data.season, f).bestOf : slot.roundInfo.bestOf;
  const meta = played
    ? 'Final'
    : f?.scheduledAt ? `${fmtDay(f.scheduledAt)} · ${fmtTime(f.scheduledAt)}` : 'Date TBC';
  const inner = `
    ${teamLine(data, slot.homeTeamId, slot.homeSeed, sets(slot.homeTeamId), state(slot.homeTeamId))}
    ${teamLine(data, slot.awayTeamId, slot.awaySeed, sets(slot.awayTeamId), state(slot.awayTeamId))}
    <div class="bm-meta">Best of ${bestOf} · ${esc(meta)}</div>`;
  return f
    ? `<a class="bracket-match" href="${urls.match(data.season.id, f.id)}" data-link>${inner}</a>`
    : `<div class="bracket-match">${inner}</div>`;
}

// Projected bracket from the current table (nothing locked yet).
function projectedSlots(data) {
  const cfg = data.season.playoffs?.seeds ? data.season.playoffs : { ...(data.season.playoffs ?? DEFAULT_PLAYOFFS) };
  const { rows } = computeStandings(data);
  const seeds = projectedSeeds(rows, cfg.size);
  return bracketTemplate(cfg.size).map((t) => {
    const home = t.home.seed ? seeds[t.home.seed - 1] : null;
    const away = t.away.seed ? seeds[t.away.seed - 1] : null;
    return {
      ...t,
      roundInfo: cfg.rounds.find((r) => r.id === t.round) ?? { name: t.round },
      fixture: null,
      homeTeamId: home,
      awayTeamId: away,
      homeSeed: t.home.seed ?? null,
      awaySeed: t.away.seed ?? null,
      played: false,
    };
  });
}

// Returns { html, bracket, projected } for the season in `data`.
export function bracketView(data, { compact = false } = {}) {
  const bracket = resolveBracket(data.season, data.fixtures, data.results);
  const slots = bracket ? bracket.slots : projectedSlots(data);
  const rounds = [];
  for (const s of slots) {
    let col = rounds.find((r) => r.id === s.round);
    if (!col) rounds.push((col = { id: s.round, name: s.roundInfo.name, slots: [] }));
    col.slots.push(s);
  }

  const champion = bracket?.championId ? data.teamsById[bracket.championId] : null;
  const banner = champion
    ? `<div class="champion" style="--team:${esc(champion.colors?.primary ?? 'var(--gold)')}">
         <span class="eyebrow">${esc(data.season.name)} champions</span>
         <strong>${teamChip(champion, 'lg')}${esc(champion.name)}</strong>
       </div>`
    : '';

  const html = `
    ${compact ? '' : banner}
    <div class="bracket${compact ? ' compact' : ''}">
      ${rounds.map((r) => `
        <div class="bracket-round">
          <h3>${esc(r.name)}</h3>
          ${r.slots.map((s) => slotCard(data, s)).join('')}
        </div>`).join('')}
    </div>`;
  return { html, bracket, projected: !bracket, champion };
}
