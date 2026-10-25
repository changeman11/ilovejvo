// Player stats, across all events or one event: award cards (each stat's 1st, 2nd and 3rd, with the same
// names as the Discord award roles, rules/stat-style.js), then one sortable table.
// URL options: ?event=<id>  ?per=total|match|set  ?sort=<stat key>

import { loadAllBundles } from '../data.js';
import { seasonMatches } from '../rules/season.js';
import { esc, skeleton, notice, pageTitle, fmtNum, pct, teamDot, playerLink, avatarImg, urls } from '../ui.js';
import { statStyle, hex } from '../rules/stat-style.js';
import { careerStats, statDefsFor, statValue } from './career.js';

export const title = 'Stats';

export function loading() {
  return skeleton([60, 90, 420]);
}

const PERS = [['total', 'Totals'], ['match', 'Per match'], ['set', 'Per set']];

export async function render() {
  const params = new URLSearchParams(location.search);
  const all = await loadAllBundles();
  const eventId = all.some((b) => b.event.id === params.get('event')) ? params.get('event') : null;
  const bundles = eventId ? all.filter((b) => b.event.id === eventId) : all;
  const mode = PERS.some(([v]) => v === params.get('per')) ? params.get('per') : 'total';
  const defs = statDefsFor(bundles);
  const stats = careerStats(bundles);
  const people = all[0]; // any bundle has the full team/player lists

  const url = (changes) => {
    const q = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(changes)) (v ? q.set(k, v) : q.delete(k));
    const s = q.toString();
    return `/stats${s ? `?${s}` : ''}`;
  };

  if (!stats.size) {
    return `<div class="page-head">${pageTitle('Player stats', '', 'blond')}</div>${notice('No stats yet', ' Stats appear once the first results are in.', 'x')}`;
  }

  // League-wide numbers for the tiles.
  const matches = bundles.flatMap((b) => seasonMatches(b).matches).filter((m) => !m.forfeit);
  const sets = matches.reduce((n, m) => n + m.homeSets + m.awaySets, 0);
  const points = matches.reduce((n, m) => n + m.homePoints + m.awayPoints, 0);

  // Columns: MVPs (totals only), then every stat.
  const cols = [
    ...(mode === 'total' ? [{ key: 'mvps', label: 'MVP', name: 'Match MVPs' }] : []),
    ...defs,
  ];
  const sortKey = cols.some((c) => c.key === params.get('sort')) ? params.get('sort') : 'pts';
  const maxMatches = Math.max(...[...stats.values()].map((p) => p.matches));
  const minMatches = mode === 'total' ? 1 : Math.max(1, Math.ceil(maxMatches * 0.4));
  const fmt = (v) => (mode === 'total' ? String(v) : fmtNum(v, mode === 'set' ? 2 : 1));

  const rows = [...stats.values()]
    .filter((p) => p.matches >= minMatches)
    .sort((a, b) => statValue(b, sortKey, mode) - statValue(a, sortKey, mode) || a.matches - b.matches || a.playerId.localeCompare(b.playerId));

  // Each stat's look (rules/stat-style.js): emoji, readable name, colour.
  const look = (c) => statStyle(c.key, c.name);
  const vars = (c) => { const st = look(c); return `--stat:${hex(st.color)};--stat2:${hex(st.color2)}`; };
  const head = cols.map((c) => `<th class="st-head${c.key === sortKey ? ' sorted' : ''}" style="${vars(c)}" title="${esc(look(c).name)}: ${esc(look(c).blurb || c.name)}"${c.key === sortKey ? ' aria-sort="descending"' : ''}><a href="${esc(url({ sort: c.key }))}" data-link data-keep-scroll><span class="st-emoji" aria-hidden="true">${look(c).emoji}</span><span>${esc(look(c).name)}</span></a></th>`).join('');
  const top = Math.max(1e-9, ...rows.map((p) => statValue(p, sortKey, mode)));
  const medal = (i) => ['🥇', '🥈', '🥉'][i] ?? `<span class="rank">${i + 1}</span>`;
  const body = rows.map((p, i) => {
    const team = people.teamsById[p.log[p.log.length - 1]?.teamId];
    const player = people.playersById[p.playerId];
    return `<tr class="${i < 3 ? `podium p${i + 1}` : ''}">
      <td class="first"><span class="st-rank">${medal(i)}</span><span class="team">${avatarImg(player ?? { displayName: '?' }, 'avatar sm')}${playerLink(player, p.playerId)}${teamDot(team)}</span></td>
      <td>${p.matches}</td><td>${pct(p.wins, p.matches)}</td>
      ${cols.map((c) => { const v = statValue(p, c.key, mode); return c.key === sortKey
        ? `<td class="sorted" style="${vars(c)}"><span class="st-val">${fmt(v)}</span><i class="st-bar" style="width:${Math.round((v / top) * 100)}%"></i></td>`
        : `<td>${fmt(v)}</td>`; }).join('')}
    </tr>`;
  }).join('');

  // Award cards: each stat's 1st, 2nd and 3rd right now (same titles as the Discord award roles,
  // one role per place). Ties share a place and skip the next, like the bot (9, 9, 5 = 1st, 1st, 3rd).
  const PLACE = ['🥇 1st', '🥈 2nd', '🥉 3rd'];
  const cards = cols.map((c) => {
    const st = look(c);
    const sorted = [...stats.values()].filter((p) => p.matches >= minMatches && statValue(p, c.key, mode) > 0)
      .sort((a, b) => statValue(b, c.key, mode) - statValue(a, c.key, mode));
    const ranked = [];
    let place = 0;
    sorted.forEach((p, i) => {
      if (i === 0 || statValue(p, c.key, mode) < statValue(sorted[i - 1], c.key, mode)) place = i + 1;
      if (place <= 3) ranked.push({ ...p, place });
    });
    if (!ranked.length) return '';
    const [lead, ...rest] = ranked;
    const leader = people.playersById[lead.playerId];
    return `
      <a class="award-card${st.ink ? ' ink' : ''}${c.key === sortKey ? ' on' : ''}" style="${vars(c)}" href="${esc(url({ sort: c.key }))}" data-link data-keep-scroll>
        <span class="ac-top"><span class="ac-emoji" aria-hidden="true">${st.emoji}</span><span class="ac-title">${esc(st.title)}<small>${esc(st.name)}${mode === 'total' ? '' : mode === 'match' ? ' per match' : ' per set'}</small></span></span>
        <span class="ac-lead">${avatarImg(leader ?? { displayName: '?' }, 'avatar')}<span class="ac-name"><small class="ac-place">${PLACE[0]}</small>${esc(leader?.displayName ?? lead.playerId)}</span><b class="ac-num num">${fmt(statValue(lead, c.key, mode))}</b></span>
        ${rest.length ? `<span class="ac-rest">${rest.map((p) => `<span><i class="ac-place">${PLACE[p.place - 1]}</i> ${esc(people.playersById[p.playerId]?.displayName ?? p.playerId)} <b class="num">${fmt(statValue(p, c.key, mode))}</b></span>`).join('')}</span>` : ''}
      </a>`;
  }).join('');

  const eventOptions = [
    `<option value="${esc(url({ event: null }))}">All events</option>`,
    ...all.map((b) => `<option value="${esc(url({ event: b.event.id }))}"${b.event.id === eventId ? ' selected' : ''}>${esc(b.event.title)}</option>`),
  ].join('');

  return `
    <div class="page-head">
      ${pageTitle('Player stats', `${eventId ? esc(bundles[0].event.title) : 'All events combined'}. Tap a column to sort.`, 'blond')}
      ${all.length > 1 ? `<label class="picker"><span class="sr-only">Event</span><select data-nav>${eventOptions}</select></label>` : ''}
    </div>
    <div class="stack">
      <div class="tiles">
        <div class="tile"><b>${matches.length}</b><span>Matches</span></div>
        <div class="tile"><b>${sets}</b><span>Sets</span></div>
        <div class="tile"><b>${points}</b><span>Points scored</span></div>
        <div class="tile"><b>${stats.size}</b><span>Players</span></div>
      </div>
      ${cards ? `<section><div class="section-head"><h2>🏆 Award holders</h2><span class="muted small">1st, 2nd and 3rd each get their own Discord role</span></div><div class="award-grid">${cards}</div></section>` : ''}
      <div>
        <nav class="chips">${PERS.map(([v, label]) => `<a class="chip-link" href="${esc(url({ per: v === 'total' ? null : v }))}" data-link data-keep-scroll${v === mode ? ' aria-current="true"' : ''}>${label}</a>`).join('')}</nav>
        ${mode !== 'total' ? `<p class="muted small" style="margin-bottom:8px">Averages include players with at least ${minMatches} match${minMatches === 1 ? '' : 'es'}.</p>` : ''}
        <div class="panel flush">
          <div class="table-wrap"><table class="data stats-table">
            <thead><tr><th class="first">Player</th><th title="Matches">M</th><th title="Matches won">Win</th>${head}</tr></thead>
            <tbody>${body}</tbody>
          </table></div>
        </div>
      </div>
    </div>`;
}
