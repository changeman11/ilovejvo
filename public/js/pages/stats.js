// Statistics: Overview (league totals + leaders), Players (sortable), Teams, Compare, Race chart.
// URL options: ?season=  ?view=overview|players|teams|compare|race  ?per=total|match|set|advanced
//              ?sort=<stat>  ?stat=<stat> (race)  ?a=&b= (compare)
// Playoff games count in all of these (JVO's rule); the league table doesn't.

import { loadSeasonFromUrl } from '../data.js';
import { seasonMatches } from '../rules/season.js';
import { seasonPlayerStats, seasonTeamStats } from '../rules/stats.js';
import { esc, skeleton, notice, fmtNum, pct, teamChip, playerLink } from '../ui.js';
import { seasonPicker } from './parts.js';
import { lineChart, mountLineChart, SERIES_COLOURS } from '../charts.js';

export const title = 'Statistics';

export function loading() {
  return `<div class="grid">${skeleton([60, 44, 120, 400])}</div>`;
}

export function mount(el) {
  mountLineChart(el);
}

const VIEWS = [
  ['overview', 'Overview'],
  ['players', 'Players'],
  ['teams', 'Teams'],
  ['compare', 'Compare'],
  ['race', 'Race'],
];
const PERS = [['total', 'Totals'], ['match', 'Per match'], ['set', 'Per set']];

// Value of a stat for a player/team entry under a "per" mode.
function per(entry, key, mode) {
  const total = key === 'mvps' ? entry.mvps : entry.totals[key] ?? 0;
  if (mode === 'match') return entry.matches ? total / entry.matches : 0;
  if (mode === 'set') return entry.sets ? total / entry.sets : 0;
  return total;
}
const show = (v, mode) => (mode === 'total' ? String(v) : fmtNum(v, mode === 'set' ? 2 : 1));

export async function render() {
  const data = await loadSeasonFromUrl();
  const params = new URLSearchParams(location.search);
  const view = VIEWS.some(([v]) => v === params.get('view')) ? params.get('view') : 'overview';
  const statDefs = data.season.stats ?? [];
  const statKeys = statDefs.map((s) => s.key);
  const { matches } = seasonMatches(data);
  const players = seasonPlayerStats({ matches, results: data.results, statKeys });
  const maxMatches = Math.max(0, ...[...players.values()].map((p) => p.matches));
  const minForRates = Math.max(1, Math.ceil(maxMatches * 0.4)); // keeps one-game wonders off average lists

  // Builds a /stats URL, keeping the season and changing only what's given.
  const url = (changes = {}) => {
    const q = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(changes)) {
      if (v == null) q.delete(k);
      else q.set(k, v);
    }
    return `/stats?${q}`;
  };
  const chips = (items, key, current) => `<nav class="chips">${items
    .map(([v, label]) => `<a class="chip-link" href="${esc(url({ [key]: v }))}" data-link data-keep-scroll${v === current ? ' aria-current="true"' : ''}>${esc(label)}</a>`)
    .join('')}</nav>`;

  const teamOf = (p) => data.teamsById[p.log[p.log.length - 1]?.teamId];

  let body = '';
  if (!matches.length) {
    body = notice('No stats yet', ' Stats appear after the first result is in.');
  } else if (view === 'overview') {
    body = overview();
  } else if (view === 'players') {
    body = playersTable();
  } else if (view === 'teams') {
    body = teamsTable();
  } else if (view === 'compare') {
    body = compare();
  } else {
    body = race();
  }

  // ---------- Overview ----------
  function overview() {
    const mode = PERS.some(([v]) => v === params.get('per')) ? params.get('per') : 'total';
    const real = matches.filter((m) => !m.forfeit);
    const sets = real.flatMap((m) => data.results[m.fixtureId].sets);
    const points = sets.reduce((n, s) => n + s.home + s.away, 0);
    const deuce = sets.filter((s) => Math.max(s.home, s.away) > (data.season.format?.pointsPerSet ?? 10)).length;
    const categories = [...statDefs, { key: 'mvps', label: 'MVP', name: 'Match MVPs' }];

    const cards = categories.map((s) => {
      const ranked = [...players.values()]
        .filter((p) => mode === 'total' || p.matches >= minForRates)
        .map((p) => ({ p, v: per(p, s.key, mode) }))
        .filter((r) => r.v > 0)
        .sort((a, b) => b.v - a.v || a.p.matches - b.p.matches || a.p.playerId.localeCompare(b.p.playerId))
        .slice(0, 5);
      if (!ranked.length) return '';
      return `
        <section class="card leader-card">
          <h3 title="${esc(s.name)}">${esc(s.name)}</h3>
          <ol>${ranked.map((r, i) => `<li class="${i === 0 ? 'first' : ''}"><span class="lrank">${i + 1}</span>${teamChip(teamOf(r.p))}${playerLink(data.playersById[r.p.playerId], r.p.playerId)}<b class="num">${show(r.v, mode)}</b></li>`).join('')}</ol>
          <a class="small more" href="${esc(url({ view: 'players', sort: s.key, per: mode === 'total' ? null : mode }))}" data-link>Full list →</a>
        </section>`;
    }).join('');

    return `
      <section class="tiles tiles-6">
        <div><b class="num">${matches.length}</b><span>Matches</span></div>
        <div><b class="num">${sets.length}</b><span>Sets</span></div>
        <div><b class="num">${points}</b><span>Points</span></div>
        <div><b class="num">${sets.length ? fmtNum(points / sets.length, 1) : '–'}</b><span>Points / set</span></div>
        <div><b class="num">${deuce}</b><span>Deuce sets</span></div>
        <div><b class="num">${matches.length - real.length}</b><span>Forfeits</span></div>
      </section>
      ${chips(PERS, 'per', mode)}
      ${mode !== 'total' ? `<p class="muted small">Averages list players with at least ${minForRates} matches.</p>` : ''}
      <div class="leader-grid">${cards}</div>`;
  }

  // ---------- Players (sortable full table) ----------
  function playersTable() {
    const modes = [...PERS, ['advanced', 'Advanced']];
    const mode = modes.some(([v]) => v === params.get('per')) ? params.get('per') : 'total';

    // Team points in each match, for "share of team points".
    const teamPts = {};
    for (const m of matches) {
      for (const line of Object.values(data.results[m.fixtureId].playerStats ?? {})) {
        const k = `${m.fixtureId}|${line.teamId}`;
        teamPts[k] = (teamPts[k] ?? 0) + (Number(line.pts) || 0);
      }
    }
    const advanced = [
      { key: 'win', label: 'W%', name: 'Win rate', value: (p) => (p.matches ? p.wins / p.matches : 0), fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'mvprate', label: 'MVP%', name: 'Share of matches as MVP', value: (p) => (p.matches ? p.mvps / p.matches : 0), fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'ptsshare', label: 'PTS share', name: 'Share of team PTS while playing', value: (p) => {
        const team = p.log.reduce((n, l) => n + (teamPts[`${l.fixtureId}|${l.teamId}`] ?? 0), 0);
        return team ? p.totals.pts / team : 0;
      }, fmt: (v) => `${Math.round(v * 100)}%` },
      ...['pts', 'spk', 'dig', 'ast'].filter((k) => statKeys.includes(k)).map((k) => ({
        key: `${k}set`, label: `${statDefs.find((s) => s.key === k).label}/set`, name: `${statDefs.find((s) => s.key === k).name} per set`,
        value: (p) => (p.sets ? (p.totals[k] ?? 0) / p.sets : 0), fmt: (v) => fmtNum(v, 2),
      })),
    ];

    const cols = mode === 'advanced'
      ? advanced
      : [
        ...(mode === 'total' ? [{ key: 'mvps', label: 'MVP', name: 'Match MVPs', value: (p) => p.mvps, fmt: String }] : []),
        ...statDefs.map((s) => ({ key: s.key, label: s.label, name: s.name, value: (p) => per(p, s.key, mode), fmt: (v) => show(v, mode) })),
      ];
    const sortKey = cols.some((c) => c.key === params.get('sort')) ? params.get('sort') : cols.find((c) => c.key === 'pts' || c.key === 'ptsshare')?.key ?? cols[0].key;
    const sortCol = cols.find((c) => c.key === sortKey);

    const rows = [...players.values()]
      .filter((p) => mode === 'total' || p.matches >= minForRates)
      .sort((a, b) => sortCol.value(b) - sortCol.value(a) || a.matches - b.matches || a.playerId.localeCompare(b.playerId));

    const head = cols.map((c) => `<th title="${esc(c.name)}"${c.key === sortKey ? ' aria-sort="descending"' : ''}><a href="${esc(url({ sort: c.key }))}" data-link data-keep-scroll>${esc(c.label)}${c.key === sortKey ? ' ↓' : ''}</a></th>`).join('');
    const body = rows.map((p, i) => `
      <tr>
        <td class="team-col"><span class="rank num">${i + 1}</span>${teamChip(teamOf(p))} ${playerLink(data.playersById[p.playerId], p.playerId)}</td>
        <td class="num">${p.matches}</td>
        ${cols.map((c) => `<td class="num${c.key === sortKey ? ' sorted' : ''}">${c.fmt(c.value(p))}</td>`).join('')}
      </tr>`).join('');

    return `
      ${chips(modes, 'per', mode)}
      ${mode !== 'total' ? `<p class="muted small">Players with at least ${minForRates} matches. Tap a column to sort.</p>` : '<p class="muted small">Tap a column to sort.</p>'}
      <section class="card">
        <div class="table-wrap"><table class="data sortable">
          <thead><tr><th class="team-col">Player</th><th title="Matches">M</th>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table></div>
      </section>`;
  }

  // ---------- Teams ----------
  function teamsTable() {
    const mode = PERS.some(([v]) => v === params.get('per')) ? params.get('per') : 'total';
    const totals = seasonTeamStats({ matches, results: data.results, statKeys });
    const record = {};
    for (const m of matches) {
      for (const [id, isHome] of [[m.homeTeamId, true], [m.awayTeamId, false]]) {
        const r = (record[id] ??= { w: 0, l: 0, sw: 0, sl: 0, pf: 0, pa: 0 });
        const won = m.winner === (isHome ? 'home' : 'away');
        r.w += won ? 1 : 0;
        r.l += won ? 0 : 1;
        r.sw += isHome ? m.homeSets : m.awaySets;
        r.sl += isHome ? m.awaySets : m.homeSets;
        r.pf += isHome ? m.homePoints : m.awayPoints;
        r.pa += isHome ? m.awayPoints : m.homePoints;
      }
    }
    const rows = [...totals.values()]
      .sort((a, b) => per(b, 'pts', mode) - per(a, 'pts', mode))
      .map((t) => {
        const r = record[t.teamId];
        return `<tr>
          <td class="team-col"><span class="team">${teamChip(data.teamsById[t.teamId])}${esc(data.teamsById[t.teamId]?.name ?? t.teamId)}</span></td>
          <td class="num">${t.matches}</td><td class="num">${r.w}–${r.l}</td><td class="num">${r.sw}–${r.sl}</td><td class="num">${r.pf}–${r.pa}</td>
          ${statDefs.map((s) => `<td class="num">${show(per(t, s.key, mode), mode)}</td>`).join('')}
        </tr>`;
      }).join('');
    return `
      ${chips(PERS, 'per', mode)}
      <p class="muted small">All matches, playoffs included.</p>
      <section class="card">
        <div class="table-wrap"><table class="data">
          <thead><tr><th class="team-col">Team</th><th title="Matches">M</th><th>W–L</th><th>Sets</th><th>Points</th>${statDefs.map((s) => `<th title="${esc(s.name)}">${esc(s.label)}</th>`).join('')}</tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </section>`;
  }

  // ---------- Compare two players ----------
  function compare() {
    const ranked = [...players.values()].sort((a, b) => b.totals.pts - a.totals.pts || a.playerId.localeCompare(b.playerId));
    const a = players.get(params.get('a')) ?? ranked[0];
    const b = players.get(params.get('b')) ?? ranked.find((p) => p !== a);
    if (!a || !b) return notice('Not enough players yet', '');
    const name = (p) => data.playersById[p.playerId]?.displayName ?? p.playerId;
    const options = (current, key) => ranked
      .map((p) => `<option value="${esc(url({ [key]: p.playerId }))}"${p === current ? ' selected' : ''}>${esc(name(p))}</option>`)
      .join('');

    const bars = [...statDefs, { key: 'mvps', label: 'MVP', name: 'Match MVPs' }].map((s) => {
      const va = per(a, s.key, 'match');
      const vb = per(b, s.key, 'match');
      const max = Math.max(va, vb) || 1;
      return `
        <div class="cmp-row">
          <span class="num ${va > vb ? 'lead' : ''}">${fmtNum(va, 1)}</span>
          <div class="cmp-bar left"><i style="width:${(va / max) * 100}%;background:${SERIES_COLOURS[0]}"></i></div>
          <span class="cmp-label" title="${esc(s.name)}">${esc(s.label)}</span>
          <div class="cmp-bar right"><i style="width:${(vb / max) * 100}%;background:${SERIES_COLOURS[1]}"></i></div>
          <span class="num ${vb > va ? 'lead' : ''}">${fmtNum(vb, 1)}</span>
        </div>`;
    }).join('');

    // Matches where they were on opposite teams.
    const meetings = a.log.filter((la) => b.log.some((lb) => lb.fixtureId === la.fixtureId && lb.teamId !== la.teamId));
    const aWins = meetings.filter((m) => m.won).length;

    return `
      <section class="card">
        <div class="cmp-pickers">
          <label class="field"><span><i class="key" style="background:${SERIES_COLOURS[0]}"></i>Player A</span><select data-nav>${options(a, 'a')}</select></label>
          <label class="field"><span><i class="key" style="background:${SERIES_COLOURS[1]}"></i>Player B</span><select data-nav>${options(b, 'b')}</select></label>
        </div>
        <div class="cmp-summary">
          <div>${playerLink(data.playersById[a.playerId], a.playerId)}<small class="muted">${a.matches} matches · ${pct(a.wins, a.matches)} won</small></div>
          <div>${playerLink(data.playersById[b.playerId], b.playerId)}<small class="muted">${b.matches} matches · ${pct(b.wins, b.matches)} won</small></div>
        </div>
        <p class="muted small" style="text-align:center">Per match averages</p>
        <div class="cmp">${bars}</div>
        <p class="muted small" style="text-align:center;margin-top:14px">${meetings.length
          ? `Head to head: ${esc(name(a))} ${aWins}–${meetings.length - aWins} ${esc(name(b))} in ${meetings.length} meeting${meetings.length === 1 ? '' : 's'}`
          : 'They haven’t played against each other this season.'}</p>
      </section>`;
  }

  // ---------- Race chart ----------
  function race() {
    const options = [...statDefs, { key: 'mvps', label: 'MVP', name: 'Match MVPs' }];
    const stat = options.find((s) => s.key === params.get('stat')) ?? options[0];
    const rounds = [...new Set(matches.map((m) => m.round))].sort((x, y) => x - y);
    const fixtureById = Object.fromEntries(data.fixtures.map((f) => [f.id, f]));
    const xLabels = rounds.map((r) => {
      const f = matches.find((m) => m.round === r);
      const fx = fixtureById[f.fixtureId];
      return fx?.stage === 'playoffs' ? (data.season.playoffs?.rounds?.find((x) => x.id === fx.playoffRound)?.short ?? 'PO') : `R${r}`;
    });
    const top = [...players.values()]
      .sort((x, y) => per(y, stat.key, 'total') - per(x, stat.key, 'total') || x.playerId.localeCompare(y.playerId))
      .slice(0, 5)
      .filter((p) => per(p, stat.key, 'total') > 0);

    const series = top.map((p) => {
      let running = 0;
      const values = rounds.map((r) => {
        for (const l of p.log.filter((x) => x.round === r)) running += stat.key === 'mvps' ? (l.mvp ? 1 : 0) : l.line[stat.key] ?? 0;
        return running;
      });
      return { id: p.playerId, name: data.playersById[p.playerId]?.displayName ?? p.playerId, values };
    });

    const statOptions = options.map((s) => `<option value="${esc(url({ stat: s.key }))}"${s === stat ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
    return `
      <section class="card">
        <div class="section-head">
          <h2>${esc(stat.name)} race</h2>
          <label class="picker"><span class="sr-only">Stat</span><select data-nav>${statOptions}</select></label>
        </div>
        <p class="muted small">Running totals after each round for this season’s top 5.</p>
        ${series.length ? lineChart({ series, xLabels, yLabel: stat.name }) : '<p class="muted">Nobody has any yet.</p>'}
      </section>`;
  }

  return {
    title: 'Statistics',
    html: `
      <section class="hero hero-row">
        <div>
          <span class="eyebrow">${esc(data.season.name)}</span>
          <h1>Statistics</h1>
        </div>
        ${seasonPicker(data, '/stats')}
      </section>
      ${chips(VIEWS, 'view', view)}
      <div class="grid">${body}</div>`,
  };
}
