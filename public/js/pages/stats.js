// Player stats (redone 2026-11-21). Three VIEWS pick which matches count: 🔥 Last event (default,
// the newest event with stats), 🌏 All time (every event), 🗄️ Archived (an older event, picked from
// a list). Each view has three TABS:
//   ✨ Overview: headline numbers, award holders (Last event; the same as the Discord 1st/2nd/3rd
//      award roles, rules/award-event.js) or leaders, single-match records, per-set efficiency,
//      a team snapshot.
//   👤 Players: the full sortable table (totals / per match / per set), filter by team.
//   🛡️ Teams: every team side by side (record, sets, points, stat totals or per set).
// URL options: ?event=<id>|all|archived  ?tab=overview|players|teams  ?per=total|match|set
//              ?sort=<stat key>  ?team=<teamId> (players tab)

import { loadAllBundles } from '../data.js';
import { seasonMatches } from '../rules/season.js';
import { seasonTeamStats } from '../rules/stats.js';
import { esc, skeleton, notice, pageTitle, fmtNum, pct, teamDot, teamLink, playerLink, avatarImg, urls } from '../ui.js';
import { statStyle, hex } from '../rules/stat-style.js';
import { careerStats, statDefsFor, statValue } from './career.js';
import { awardEvent, statsEvents } from '../rules/award-event.js';
import { navigate } from '../nav.js';

export const title = 'Stats';

export function loading() {
  return skeleton([60, 90, 420]);
}

const PERS = [['total', 'Totals'], ['match', 'Per match'], ['set', 'Per set']];
const TABS = [['overview', '✨ Overview'], ['players', '👤 Players'], ['teams', '🛡️ Teams'], ['compare', '⚖️ Compare']];
const PLACE = ['🥇 1st', '🥈 2nd', '🥉 3rd'];

// Each stat's look (rules/stat-style.js): emoji, readable name, colour, as CSS variables.
const look = (c) => statStyle(c.key, c.name);
const vars = (c) => { const st = look(c); return `--stat:${hex(st.color)};--stat2:${hex(st.color2)}`; };

// 1st, 2nd and 3rd for one stat (ties share a place and skip the next: 9, 9, 5 = 1st, 1st, 3rd).
function podiumFor(stats, key) {
  const value = (p) => statValue(p, key, 'total');
  const sorted = [...stats.values()].filter((p) => value(p) > 0).sort((a, b) => value(b) - value(a) || a.matches - b.matches);
  const out = [];
  let place = 0;
  sorted.forEach((p, i) => {
    if (i === 0 || value(p) < value(sorted[i - 1])) place = i + 1;
    if (place <= 3) out.push({ p, place, v: value(p) });
  });
  return out;
}

export async function render() {
  const params = new URLSearchParams(location.search);
  const all = await loadAllBundles();
  // Views: the last event with stats (default), all time ("all"), or an archived (older) event.
  const withStats = statsEvents(all);
  const latestId = withStats[0]?.event.id ?? null;
  const archive = withStats.slice(1);
  const asked = params.get('event');
  const eventId = asked === 'all' ? null
    : asked === 'archived' ? (archive[0]?.event.id ?? latestId)
    : all.some((b) => b.event.id === asked) ? asked : latestId;
  const view = !eventId ? 'all' : eventId === latestId ? 'last' : 'archived';
  const bundles = eventId ? all.filter((b) => b.event.id === eventId) : all;
  const tab = TABS.some(([v]) => v === params.get('tab')) ? params.get('tab') : 'overview';
  const mode = PERS.some(([v]) => v === params.get('per')) ? params.get('per') : 'total';
  const defs = statDefsFor(bundles);
  const stats = careerStats(bundles);
  const people = all[0]; // any bundle has the full team/player lists
  const player = (id) => people?.playersById[id];
  const team = (id) => people?.teamsById[id];
  const eventTitle = (id) => all.find((b) => b.event.id === id)?.event.title ?? '';

  const url = (changes) => {
    const q = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(changes)) (v ? q.set(k, v) : q.delete(k));
    const s = q.toString();
    return `/stats${s ? `?${s}` : ''}`;
  };

  if (!stats.size) {
    return `<div class="page-head">${pageTitle('Player stats', '', 'blond')}</div>${notice('No stats yet', ' Stats appear once the first results are in.', 'x')}`;
  }

  // ---------- Header: view + tabs ----------
  const VIEWS = [['last', '🔥 Last event', latestId], ['all', '🌏 All time', 'all'], ['archived', '🗄️ Archived', 'archived']];
  const viewTabs = `<nav class="chips stats-views" aria-label="Which stats">${VIEWS
    .filter(([v]) => v !== 'archived' || archive.length)
    .map(([v, label, ev]) => `<a class="chip-link" href="${esc(url({ event: v === 'last' ? null : ev, sort: null, team: null }))}" data-link data-keep-scroll${v === view ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;
  const archivePicker = view === 'archived' ? `<label class="picker"><span class="muted small">Event</span> <select data-nav>${archive.map((b) => `<option value="${esc(url({ event: b.event.id }))}"${b.event.id === eventId ? ' selected' : ''}>${esc(b.event.title)}</option>`).join('')}</select></label>` : '';
  const heading = view === 'all' ? 'All time · every event combined' : view === 'last' ? `Last event · ${bundles[0].event.title}` : `Archived · ${bundles[0].event.title}`;
  const tabNav = `<nav class="stats-tabs" aria-label="Stats sections">${TABS.map(([v, label]) => `<a href="${esc(url({ tab: v === 'overview' ? null : v }))}" data-link data-keep-scroll${v === tab ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;

  // Matches in this view (forfeits have no stats or real points).
  const matchList = bundles.flatMap((b) => seasonMatches(b).matches.map((m) => ({ ...m, eventId: b.event.id }))).filter((m) => !m.forfeit);

  let body = '';
  if (tab === 'overview') body = overview();
  else if (tab === 'players') body = playersTab();
  else if (tab === 'compare') body = compareTab();
  else body = teamsTab();

  // Search: filters the Players / Teams tables as you type (mount() below); on the other tabs,
  // Enter opens the Players tab with the search filled in.
  const q = params.get('q') ?? '';
  const searchBox = tab === 'compare' ? '' : `<form class="stats-search" data-stats-search-form data-go="${esc(url({ tab: 'players', q: null, team: null }))}" role="search">
      <span aria-hidden="true">🔎</span>
      <input type="search" name="q" value="${esc(q)}" placeholder="${tab === 'teams' ? 'Search teams or players' : 'Search players or teams'}" autocomplete="off" data-stats-search${tab === 'overview' ? '' : ' data-live'} aria-label="Search stats">
    </form>`;

  return `
    <div class="page-head">
      ${pageTitle('Stats', esc(heading), 'blond')}
    </div>
    <div class="stack stats-page">
      <div class="stats-viewbar">${viewTabs}${archivePicker}</div>
      ${tabNav}
      ${searchBox}
      ${body}
    </div>`;

  // ---------- ✨ Overview ----------
  function overview() {
    const sets = matchList.reduce((n, m) => n + m.homeSets + m.awaySets, 0);
    const points = matchList.reduce((n, m) => n + m.homePoints + m.awayPoints, 0);
    const deciders = matchList.filter((m) => Math.min(m.homeSets, m.awaySets) > 0).length;
    const tiles = [
      [matchList.length, 'Matches'],
      [sets, 'Sets'],
      [points, 'Points scored'],
      [sets ? fmtNum(points / sets, 1) : '–', 'Points per set'],
      [matchList.length ? `${Math.round((deciders / matchList.length) * 100)}%` : '–', 'Went the distance'],
      [stats.size, 'Players'],
    ];

    // Award holders (Last event: the Discord roles) or leaders (other views), one card per stat.
    const cardStats = view === 'last' ? careerStats([awardEvent(all) ?? bundles[0]]) : stats;
    const cardCols = [{ key: 'mvps', name: 'Match MVPs' }, ...defs];
    const cards = cardCols.map((c) => {
      const st = look(c);
      const ranked = podiumFor(cardStats, c.key);
      if (!ranked.length) return '';
      const [lead, ...rest] = ranked;
      const leader = player(lead.p.playerId);
      return `
      <a class="award-card${st.ink ? ' ink' : ''}" style="${vars(c)}" href="${esc(url({ tab: 'players', sort: c.key, per: null }))}" data-link>
        <span class="ac-top"><span class="ac-emoji" aria-hidden="true">${st.emoji}</span><span class="ac-title">${esc(st.title)}<small>${esc(st.name)}</small></span></span>
        <span class="ac-lead">${avatarImg(leader ?? { displayName: '?' }, 'avatar')}<span class="ac-name"><small class="ac-place">${PLACE[0]}</small>${esc(leader?.displayName ?? lead.p.playerId)}</span><b class="ac-num num">${lead.v}</b></span>
        ${rest.length ? `<span class="ac-rest">${rest.slice(0, 3).map((r) => `<span><i class="ac-place">${PLACE[r.place - 1]}</i> ${esc(player(r.p.playerId)?.displayName ?? r.p.playerId)} <b class="num">${r.v}</b></span>`).join('')}${rest.length > 3 ? `<span class="ac-more">+ ${rest.length - 3} more tied</span>` : ''}</span>` : ''}
      </a>`;
    }).join('');
    const cardsHead = view === 'last'
      ? `<h2>🏆 Award holders</h2><span class="muted small">The top 3s of this event. Each place is a Discord role, and they move to the next event's top 3s as soon as its stats come in.</span>`
      : `<h2>🏅 Leaders</h2><span class="muted small">${view === 'all' ? 'Totals across every event.' : 'Totals at this event.'} Tap a card for the full list.</span>`;

    // Best single-match lines, one per stat.
    const records = defs.map((c) => {
      let best = null;
      for (const p of stats.values()) {
        for (const l of p.log) {
          const v = Number(l.line?.[c.key]) || 0;
          if (v > 0 && (!best || v > best.v)) best = { v, p, l };
        }
      }
      if (!best) return '';
      const st = look(c);
      const pl = player(best.p.playerId);
      const opp = team(best.l.opponentId);
      return `<a class="record-card" style="${vars(c)}" href="${esc(urls.match(best.l.eventId, best.l.fixtureId))}" data-link>
        <span class="rc-emoji" aria-hidden="true">${st.emoji}</span>
        <span class="rc-text"><small>Most ${esc(st.name.toLowerCase())} in a match</small><b>${esc(pl?.displayName ?? best.p.playerId)}</b><span class="muted small">vs ${esc(opp?.name ?? 'TBC')}${view === 'all' ? ` · ${esc(eventTitle(best.l.eventId))}` : ''}</span></span>
        <span class="rc-num num">${best.v}</span>
      </a>`;
    }).join('');

    // Per-set efficiency: points per set, for players with enough matches.
    const maxMatches = Math.max(...[...stats.values()].map((p) => p.matches));
    const minM = Math.max(1, Math.ceil(maxMatches * 0.4));
    const eff = [...stats.values()].filter((p) => p.matches >= minM && p.sets)
      .map((p) => ({ p, v: p.totals.pts / p.sets })).sort((a, b) => b.v - a.v).slice(0, 5);
    const effTop = eff[0]?.v || 1;
    const effList = eff.map(({ p, v }, i) => {
      const pl = player(p.playerId);
      return `<li><span class="ml-rank">${i + 1}</span>${avatarImg(pl ?? { displayName: '?' }, 'avatar sm')}<span class="ml-name">${playerLink(pl, p.playerId)}${teamDot(team(p.log[p.log.length - 1]?.teamId))}</span><span class="ml-bar"><i style="width:${Math.round((v / effTop) * 100)}%"></i></span><b class="num">${fmtNum(v, 2)}</b></li>`;
    }).join('');

    // Team snapshot: the top 4 by wins.
    const teamsTop = teamRows().slice(0, 4);
    const snap = teamsTop.map((t, i) => `<li><span class="ml-rank">${i + 1}</span><span class="ml-name">${teamLink(team(t.teamId) ?? { id: t.teamId, name: t.teamId })}</span><span class="muted small">${t.wins}–${t.matches - t.wins}</span><b class="num">${t.sets ? fmtNum(t.pf / t.sets, 1) : '–'}</b></li>`).join('');

    return `
      <div class="tiles stats-tiles">${tiles.map(([v, l]) => `<div class="tile"><b>${v}</b><span>${l}</span></div>`).join('')}</div>
      ${cards ? `<section><div class="section-head">${cardsHead}</div><div class="award-grid">${cards}</div></section>` : ''}
      ${records ? `<section><div class="section-head"><h2>🔥 Single-match records</h2><span class="muted small">The biggest one-match numbers${view === 'all' ? ' ever' : ''}. Tap one to see the match.</span></div><div class="record-grid">${records}</div></section>` : ''}
      <div class="stats-duo">
        ${effList ? `<section class="panel mini-board"><div class="section-head"><h2>⚡ Points per set</h2><span class="muted small">Players with ${minM}+ match${minM === 1 ? '' : 'es'}</span></div><ol class="mini-list">${effList}</ol><a class="more-link" href="${esc(url({ tab: 'players', per: 'set', sort: 'pts' }))}" data-link>Full per-set table →</a></section>` : ''}
        ${snap ? `<section class="panel mini-board"><div class="section-head"><h2>🛡️ Top teams</h2><span class="muted small">Wins · points per set</span></div><ol class="mini-list">${snap}</ol><a class="more-link" href="${esc(url({ tab: 'teams' }))}" data-link>Every team →</a></section>` : ''}
      </div>`;
  }

  // ---------- 👤 Players ----------
  function playersTab() {
    const cols = [...(mode === 'total' ? [{ key: 'mvps', name: 'Match MVPs' }] : []), ...defs];
    const sortKey = cols.some((c) => c.key === params.get('sort')) ? params.get('sort') : 'pts';
    const maxMatches = Math.max(...[...stats.values()].map((p) => p.matches));
    const minMatches = mode === 'total' ? 1 : Math.max(1, Math.ceil(maxMatches * 0.4));
    const fmt = (v) => (mode === 'total' ? String(v) : fmtNum(v, mode === 'set' ? 2 : 1));
    // Team filter: the teams players played for in this view.
    const teamIds = [...new Set([...stats.values()].flatMap((p) => p.teamIds))].filter((id) => team(id))
      .sort((a, b) => team(a).name.localeCompare(team(b).name));
    const teamId = teamIds.includes(params.get('team')) ? params.get('team') : null;
    const rows = [...stats.values()]
      .filter((p) => p.matches >= minMatches && (!teamId || p.teamIds.includes(teamId)))
      .sort((a, b) => statValue(b, sortKey, mode) - statValue(a, sortKey, mode) || a.matches - b.matches || a.playerId.localeCompare(b.playerId));
    const head = cols.map((c) => `<th class="st-head${c.key === sortKey ? ' sorted' : ''}" style="${vars(c)}" title="${esc(look(c).name)}: ${esc(look(c).blurb || c.name)}"${c.key === sortKey ? ' aria-sort="descending"' : ''}><a href="${esc(url({ sort: c.key }))}" data-link data-keep-scroll><span class="st-emoji" aria-hidden="true">${look(c).emoji}</span><span>${esc(look(c).name)}</span></a></th>`).join('');
    const top = Math.max(1e-9, ...rows.map((p) => statValue(p, sortKey, mode)));
    const medal = (i) => ['🥇', '🥈', '🥉'][i] ?? `<span class="rank">${i + 1}</span>`;
    const body = rows.map((p, i) => {
      const pl = player(p.playerId);
      const words = [pl?.displayName ?? p.playerId, ...(pl?.gameNames ?? []), ...p.teamIds.map((id) => team(id)?.name ?? '')].join(' ').toLowerCase();
      return `<tr class="${i < 3 ? `podium p${i + 1}` : ''}" data-search="${esc(words)}">
        <td class="first"><span class="st-rank">${medal(i)}</span><span class="team">${avatarImg(pl ?? { displayName: '?' }, 'avatar sm')}${playerLink(pl, p.playerId)}${teamDot(team(p.log[p.log.length - 1]?.teamId))}</span></td>
        <td>${p.matches}</td><td>${pct(p.wins, p.matches)}</td>
        ${cols.map((c) => { const v = statValue(p, c.key, mode); return c.key === sortKey
          ? `<td class="sorted" style="${vars(c)}"><span class="st-val">${fmt(v)}</span><i class="st-bar" style="width:${Math.round((v / top) * 100)}%"></i></td>`
          : `<td>${fmt(v)}</td>`; }).join('')}
      </tr>`;
    }).join('');
    const teamPicker = teamIds.length > 1 ? `<label class="picker"><span class="sr-only">Team</span><select data-nav>
      <option value="${esc(url({ team: null }))}">All teams</option>
      ${teamIds.map((id) => `<option value="${esc(url({ team: id }))}"${id === teamId ? ' selected' : ''}>${esc(team(id).name)}</option>`).join('')}
    </select></label>` : '';
    return `
      <div class="stats-toolbar">
        <nav class="chips">${PERS.map(([v, label]) => `<a class="chip-link" href="${esc(url({ per: v === 'total' ? null : v }))}" data-link data-keep-scroll${v === mode ? ' aria-current="true"' : ''}>${label}</a>`).join('')}</nav>
        ${teamPicker}
      </div>
      <p class="muted small">Sorted by <b>${esc(look(cols.find((c) => c.key === sortKey)).name)}</b>${mode !== 'total' ? ` · averages for players with ${minMatches}+ match${minMatches === 1 ? '' : 'es'}` : ''}. Tap a column to sort.</p>
      ${rows.length ? `<div class="panel flush">
        <div class="table-wrap"><table class="data stats-table">
          <thead><tr><th class="first">Player</th><th title="Matches">M</th><th title="Matches won">Win</th>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table></div>
      </div><p class="panel muted" data-search-empty hidden>Nobody matches that search.</p>` : '<p class="panel muted">Nobody here yet.</p>'}`;
  }

  // ---------- 🛡️ Teams ----------
  // Every team in this view: record, sets, points, and stat totals from its players.
  function teamRows() {
    const keys = defs.map((d) => d.key);
    const out = new Map();
    const get = (id) => {
      if (!out.has(id)) out.set(id, { teamId: id, matches: 0, wins: 0, sw: 0, sl: 0, pf: 0, pa: 0, sets: 0, totals: Object.fromEntries(keys.map((k) => [k, 0])) });
      return out.get(id);
    };
    for (const m of matchList) {
      for (const [id, home] of [[m.homeTeamId, true], [m.awayTeamId, false]]) {
        const t = get(id);
        const sf = home ? m.homeSets : m.awaySets;
        const sa = home ? m.awaySets : m.homeSets;
        t.matches++;
        if (sf > sa) t.wins++;
        t.sw += sf;
        t.sl += sa;
        t.sets += sf + sa;
        t.pf += home ? m.homePoints : m.awayPoints;
        t.pa += home ? m.awayPoints : m.homePoints;
      }
    }
    for (const b of bundles) {
      const ts = seasonTeamStats({ matches: seasonMatches(b).matches.filter((m) => !m.forfeit), results: b.results, statKeys: keys });
      for (const [id, t] of ts) for (const k of keys) get(id).totals[k] += t.totals[k] ?? 0;
    }
    return [...out.values()].sort((a, b) => b.wins - a.wins || (b.sw - b.sl) - (a.sw - a.sl) || (b.pf - b.pa) - (a.pf - a.pa));
  }

  function teamsTab() {
    const perSet = mode === 'set';
    const rows = teamRows();
    const sortKey = defs.some((c) => c.key === params.get('sort')) ? params.get('sort') : null;
    const val = (t, k) => (perSet ? (t.sets ? t.totals[k] / t.sets : 0) : t.totals[k]);
    if (sortKey) rows.sort((a, b) => val(b, sortKey) - val(a, sortKey));
    // Each team's top scorer in this view.
    const best = new Map();
    for (const p of stats.values()) {
      for (const id of p.teamIds) {
        const pts = p.log.filter((l) => l.teamId === id).reduce((n, l) => n + (Number(l.line?.pts) || 0), 0);
        if (pts > (best.get(id)?.pts ?? 0)) best.set(id, { playerId: p.playerId, pts });
      }
    }
    const top = sortKey ? Math.max(1e-9, ...rows.map((t) => val(t, sortKey))) : 1;
    const head = defs.map((c) => `<th class="st-head${c.key === sortKey ? ' sorted' : ''}" style="${vars(c)}" title="${esc(look(c).name)}"><a href="${esc(url({ sort: c.key }))}" data-link data-keep-scroll><span class="st-emoji" aria-hidden="true">${look(c).emoji}</span><span>${esc(look(c).name)}</span></a></th>`).join('');
    const body = rows.map((t, i) => {
      const tm = team(t.teamId) ?? { id: t.teamId, name: t.teamId };
      const star = best.get(t.teamId);
      const words = [tm.name, ...[...stats.values()].filter((p) => p.teamIds.includes(t.teamId)).map((p) => player(p.playerId)?.displayName ?? '')].join(' ').toLowerCase();
      return `<tr class="${i < 3 && !sortKey ? `podium p${i + 1}` : ''}" data-search="${esc(words)}">
        <td class="first"><span class="st-rank">${i + 1}</span>${teamLink(tm)}${star ? `<small class="team-star muted">⭐ ${esc(player(star.playerId)?.displayName ?? star.playerId)} · ${star.pts} pts</small>` : ''}</td>
        <td>${t.matches}</td><td><b>${t.wins}</b>–${t.matches - t.wins}</td><td>${t.sw}–${t.sl}</td><td>${t.pf}–${t.pa}</td>
        ${defs.map((c) => { const v = val(t, c.key); const shown = perSet ? fmtNum(v, 1) : v; return c.key === sortKey
          ? `<td class="sorted" style="${vars(c)}"><span class="st-val">${shown}</span><i class="st-bar" style="width:${Math.round((v / top) * 100)}%"></i></td>`
          : `<td>${shown}</td>`; }).join('')}
      </tr>`;
    }).join('');
    return `
      <div class="stats-toolbar">
        <nav class="chips">${[['total', 'Totals'], ['set', 'Per set']].map(([v, label]) => `<a class="chip-link" href="${esc(url({ per: v === 'total' ? null : v }))}" data-link data-keep-scroll${v === (perSet ? 'set' : 'total') ? ' aria-current="true"' : ''}>${label}</a>`).join('')}</nav>
        ${sortKey ? `<a class="chip-link" href="${esc(url({ sort: null }))}" data-link data-keep-scroll>↺ Order by wins</a>` : ''}
      </div>
      <p class="muted small">${sortKey ? `Sorted by <b>${esc(look(defs.find((c) => c.key === sortKey)).name)}</b>.` : 'Ordered by wins, then sets, then points.'} Stat totals add up every player's line for the team. Tap a column to sort.</p>
      <div class="panel flush">
        <div class="table-wrap"><table class="data stats-table teams-table">
          <thead><tr><th class="first">Team</th><th title="Matches">M</th><th title="Won–lost">W–L</th><th title="Sets won–lost">Sets</th><th title="Points for–against">Points</th>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table></div>
      </div><p class="panel muted" data-search-empty hidden>No team matches that search.</p>`;
  }

  // ---------- ⚖️ Compare ----------
  function compareTab() {
    return compareHtml({ stats, defs, mode, params, url, player, team, view, eventTitle });
  }
}

// ⚖️ Compare: two players side by side (?a=<playerId>&b=<playerId>), in the chosen view.
// Each stat has a tug-of-war bar (who's ahead), then head-to-head and played-together records.
function compareHtml({ stats, defs, mode, params, url, player, team, view, eventTitle }) {
  const name = (id) => player(id)?.displayName ?? id;
  const everyone = [...stats.values()].sort((x, y) => name(x.playerId).localeCompare(name(y.playerId)));
  const byPts = [...stats.values()].sort((x, y) => (y.totals.pts ?? 0) - (x.totals.pts ?? 0));
  const pick = (k, fallback) => (stats.has(params.get(k)) ? params.get(k) : fallback);
  const aId = pick('a', byPts[0]?.playerId);
  const bId = pick('b', byPts.find((p) => p.playerId !== aId)?.playerId);
  if (!aId || !bId || aId === bId) return '<p class="panel muted">Comparing needs two different players with stats.</p>';
  const A = stats.get(aId);
  const B = stats.get(bId);
  const select = (k, cur, other) => `<label class="cmp-pick"><span class="sr-only">Player ${k === 'a' ? 'one' : 'two'}</span><select data-nav>${everyone
    .map((p) => `<option value="${esc(url({ [k]: p.playerId }))}"${p.playerId === cur ? ' selected' : ''}${p.playerId === other ? ' disabled' : ''}>${esc(name(p.playerId))}</option>`).join('')}</select></label>`;
  const lastTeam = (p) => team(p.log[p.log.length - 1]?.teamId);
  const head = (p, side) => {
    const pl = player(p.playerId);
    const t = lastTeam(p);
    return `<div class="cmp-head ${side}">
      ${avatarImg(pl ?? { displayName: '?' }, 'avatar')}
      <div><b>${playerLink(pl, p.playerId)}</b><span class="muted small">${t ? `${teamDot(t)} ${esc(t.name)}` : 'No team'}</span></div>
    </div>`;
  };
  const fmt = (v) => (mode === 'total' ? String(Math.round(v * 100) / 100) : fmtNum(v, mode === 'set' ? 2 : 1));
  const rows = [
    { label: 'Matches', emoji: '🏐', a: A.matches, b: B.matches, plain: true },
    { label: 'Win rate', emoji: '✅', a: A.matches ? A.wins / A.matches : 0, b: B.matches ? B.wins / B.matches : 0, pct: true },
    ...[{ key: 'mvps', name: 'Match MVPs' }, ...defs].map((c) => {
      const st = statStyle(c.key, c.name);
      return { label: st.name, emoji: st.emoji, a: statValue(A, c.key, mode), b: statValue(B, c.key, mode), color: hex(st.color) };
    }),
  ];
  let aWins = 0;
  let bWins = 0;
  const lines = rows.map((r) => {
    const total = r.a + r.b;
    const share = total ? Math.round((r.a / total) * 100) : 50;
    const lead = r.a > r.b ? 'a' : r.b > r.a ? 'b' : '';
    if (!r.plain) { if (lead === 'a') aWins++; if (lead === 'b') bWins++; }
    const show = (v) => (r.pct ? `${Math.round(v * 100)}%` : r.plain ? String(v) : fmt(v));
    return `<div class="cmp-row${lead ? ` lead-${lead}` : ''}"${r.color ? ` style="--stat:${r.color}"` : ''}>
      <b class="cmp-val a num">${show(r.a)}</b>
      <span class="cmp-mid"><span class="cmp-label"><span aria-hidden="true">${r.emoji}</span> ${esc(r.label)}</span><span class="cmp-bar"><i style="width:${share}%"></i></span></span>
      <b class="cmp-val b num">${show(r.b)}</b>
    </div>`;
  }).join('');

  // Matches they were both in: against each other, or on the same team.
  const key = (l) => `${l.eventId}/${l.fixtureId}`;
  const bLog = new Map(B.log.map((l) => [key(l), l]));
  const against = [];
  const together = [];
  for (const la of A.log) {
    const lb = bLog.get(key(la));
    if (!lb) continue;
    (la.teamId === lb.teamId ? together : against).push({ la, lb });
  }
  const h2hA = against.filter(({ la }) => la.won).length;
  const togetherWins = together.filter(({ la }) => la.won).length;
  const matchRow = ({ la, lb }) => `<a class="cmp-match" href="${esc(urls.match(la.eventId, la.fixtureId))}" data-link>
      <span class="cmp-res ${la.won ? 'w' : 'l'}">${la.won ? 'W' : 'L'} ${la.setsFor}–${la.setsAgainst}</span>
      <span class="cmp-match-who">${esc(team(la.teamId)?.name ?? '?')} v ${esc(team(la.opponentId)?.name ?? '?')}${view === 'all' ? ` <small class="muted">· ${esc(eventTitle(la.eventId))}</small>` : ''}</span>
      <span class="num small">${Number(la.line?.pts) || 0}–${Number(lb.line?.pts) || 0} pts</span>
    </a>`;

  return `
    <div class="stats-toolbar">
      <nav class="chips">${PERS.map(([v, label]) => `<a class="chip-link" href="${esc(url({ per: v === 'total' ? null : v }))}" data-link data-keep-scroll${v === mode ? ' aria-current="true"' : ''}>${label}</a>`).join('')}</nav>
      <a class="chip-link" href="${esc(url({ a: bId, b: aId }))}" data-link data-keep-scroll>⇄ Swap</a>
    </div>
    <section class="panel cmp">
      <div class="cmp-picks">${select('a', aId, bId)}<span class="cmp-vs">VS</span>${select('b', bId, aId)}</div>
      <div class="cmp-heads">${head(A, 'a')}<div class="cmp-score"><b class="num">${aWins}</b><small>stats ahead</small><b class="num">${bWins}</b></div>${head(B, 'b')}</div>
      <div class="cmp-rows">${lines}</div>
    </section>
    <div class="stats-duo">
      <section class="panel mini-board">
        <div class="section-head"><h2>🥊 Head to head</h2><span class="muted small">${against.length ? `${esc(name(aId))} ${h2hA}–${against.length - h2hA} ${esc(name(bId))}` : 'Never played each other'}</span></div>
        ${against.length ? `<div class="cmp-matches">${against.map(matchRow).join('')}</div>` : '<p class="muted small">When they meet, their matches show here.</p>'}
      </section>
      <section class="panel mini-board">
        <div class="section-head"><h2>🤝 Played together</h2><span class="muted small">${together.length ? `${togetherWins}–${together.length - togetherWins} as teammates` : 'Never on the same team'}</span></div>
        ${together.length ? `<div class="cmp-matches">${together.map(matchRow).join('')}</div>` : '<p class="muted small">Matches on the same team show here.</p>'}
      </section>
    </div>
    <p class="muted small">Numbers are ${mode === 'total' ? 'totals' : mode === 'set' ? 'per set' : 'per match'} for ${view === 'all' ? 'every event' : 'this event'}. Each bar is a tug of war: the bigger side is ahead.</p>`;
}

// Live search on the Players and Teams tabs; Enter on the Overview opens the Players tab.
export function mount(root) {
  const input = root.querySelector('[data-stats-search]');
  if (!input) return;
  const form = input.form;
  const live = input.hasAttribute('data-live');
  const filter = () => {
    const words = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const tr of root.querySelectorAll('tr[data-search]')) {
      const hit = words.every((w) => tr.dataset.search.includes(w));
      tr.hidden = !hit;
      if (hit) shown++;
    }
    const empty = root.querySelector('[data-search-empty]');
    if (empty) empty.hidden = shown > 0;
    // Keep it in the address (no new history step), so back and refresh keep the search.
    const u = new URL(location.href);
    if (input.value.trim()) u.searchParams.set('q', input.value.trim());
    else u.searchParams.delete('q');
    history.replaceState(history.state, '', u.pathname + u.search);
    // Sorting and the Totals / Per set chips keep the search too.
    for (const a of root.querySelectorAll('.stats-toolbar a[href^="/stats"], th a[href^="/stats"]')) {
      const h = new URL(a.getAttribute('href'), location.origin);
      if (input.value.trim()) h.searchParams.set('q', input.value.trim()); else h.searchParams.delete('q');
      a.setAttribute('href', h.pathname + h.search);
    }
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (live) return filter();
    const go = new URL(form.dataset.go, location.origin);
    if (input.value.trim()) go.searchParams.set('q', input.value.trim());
    navigate(go.pathname + go.search);
  });
  if (live) {
    input.addEventListener('input', filter);
    if (input.value) filter();
  }
}
