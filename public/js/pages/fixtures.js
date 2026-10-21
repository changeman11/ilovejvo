// Fixtures & Results: one round at a time (round tabs), or every match for one team.
// URL options: ?season=s1  ?round=3  ?team=tasman-tide

import { loadSeasonFromUrl } from '../data.js';
import { esc, skeleton, notice } from '../ui.js';
import { matchRow, seasonPicker, byDay, sortByTime } from './parts.js';

export const title = 'Fixtures';

export function loading() {
  return `<div class="grid">${skeleton([60, 44, 420])}</div>`;
}

// After drawing: bring the selected round tab into view (later rounds sit off-screen on phones).
export function mount(el) {
  const chip = el.querySelector('.chip-link[aria-current]');
  const strip = chip?.parentElement;
  if (chip && strip) strip.scrollLeft = chip.offsetLeft - strip.clientWidth / 2 + chip.clientWidth / 2;
}

export async function render() {
  const data = await loadSeasonFromUrl();
  const params = new URLSearchParams(location.search);
  const teamId = data.teamsById[params.get('team')] ? params.get('team') : null;
  const fixtures = [...data.fixtures].sort(sortByTime);
  const rounds = [...new Set(fixtures.map((f) => f.round))].sort((a, b) => a - b);

  // Default round: the first one with a match still to play, else the last.
  const openRound = fixtures.find((f) => !data.results[f.id])?.round ?? rounds[rounds.length - 1];
  const asked = Number(params.get('round'));
  const round = rounds.includes(asked) ? asked : openRound;

  // Builds a /fixtures URL that keeps the season choice.
  const url = (extra = {}) => {
    const q = new URLSearchParams();
    if (params.get('season')) q.set('season', data.season.id);
    for (const [k, v] of Object.entries(extra)) if (v != null) q.set(k, v);
    const s = q.toString();
    return `/fixtures${s ? `?${s}` : ''}`;
  };

  const teamOptions = [
    `<option value="${esc(url())}">All teams</option>`,
    ...data.teams
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => `<option value="${esc(url({ team: t.id }))}"${t.id === teamId ? ' selected' : ''}>${esc(t.name)}</option>`),
  ].join('');

  let body;
  if (!fixtures.length) {
    body = notice('No fixtures yet', ' The schedule for this season hasn’t been published.');
  } else if (teamId) {
    const mine = fixtures.filter((f) => f.homeTeamId === teamId || f.awayTeamId === teamId);
    const played = mine.filter((f) => data.results[f.id]);
    const upcoming = mine.filter((f) => !data.results[f.id]);
    body = `
      ${upcoming.length ? `<section class="card"><div class="section-head"><h2>Upcoming</h2></div>
        <div class="matches">${upcoming.map((f) => matchRow(f, data, { showRound: true })).join('')}</div></section>` : ''}
      ${played.length ? `<section class="card"><div class="section-head"><h2>Results</h2></div>
        <div class="matches">${played.reverse().map((f) => matchRow(f, data, { showRound: true })).join('')}</div></section>` : ''}`;
  } else {
    const chips = rounds
      .map((r) => {
        const done = fixtures.filter((f) => f.round === r).every((f) => data.results[f.id]);
        const current = r === round ? ' aria-current="true"' : '';
        return `<a class="chip-link${done ? ' done' : ''}" href="${esc(url({ round: r }))}" data-link data-keep-scroll${current}>R${r}</a>`;
      })
      .join('');
    const inRound = fixtures.filter((f) => f.round === round);
    const days = byDay(inRound)
      .map((g) => `<h3 class="day">${esc(g.label)}</h3><div class="matches">${g.fixtures.map((f) => matchRow(f, data, { timeOnly: true })).join('')}</div>`)
      .join('');
    body = `
      <nav class="chips" aria-label="Rounds">${chips}</nav>
      <section class="card">
        <div class="section-head"><h2>Round ${esc(round)}</h2><span class="muted small">${inRound.filter((f) => data.results[f.id]).length}/${inRound.length} played</span></div>
        ${days}
      </section>`;
  }

  return {
    title: teamId ? `${data.teamsById[teamId].name} fixtures` : 'Fixtures',
    html: `
      <section class="hero hero-row">
        <div>
          <span class="eyebrow">${esc(data.season.name)}</span>
          <h1>Fixtures &amp; Results</h1>
        </div>
        <div class="pickers">
          ${seasonPicker(data, '/fixtures')}
          <label class="picker"><span class="sr-only">Team</span><select data-nav>${teamOptions}</select></label>
        </div>
      </section>
      <div class="grid">${body}</div>`,
  };
}
