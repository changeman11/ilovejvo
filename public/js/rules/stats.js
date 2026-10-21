// Player and team stats, built from results every time. Nothing here is stored.
// Pure functions, no Firebase, so they run in the browser and in tests.
//
// `matches` is the list of checked, finished matches from computeStandings()
// (or finishedMatches()), so results that break the rules are never counted.

function emptyTotals(statKeys) {
  return Object.fromEntries(statKeys.map((k) => [k, 0]));
}

// Every player's season, from the stat lines in each result.
// Options: teamId = only count lines where the player played for that team.
// Returns Map playerId -> {
//   playerId, teamIds, matches, sets, wins, mvps, totals: {pts, spk, ...},
//   log: [{ fixtureId, round, scheduledAt, teamId, opponentId, won, setsFor, setsAgainst, mvp, line }]
// }  (log is oldest first)
export function seasonPlayerStats({ matches, results, statKeys, teamId = null }) {
  const players = new Map();
  for (const m of matches) {
    const r = results[m.fixtureId];
    if (!r?.playerStats) continue;
    const setsInMatch = m.homeSets + m.awaySets;

    for (const [playerId, raw] of Object.entries(r.playerStats)) {
      const isHome = raw.teamId === m.homeTeamId;
      if (!isHome && raw.teamId !== m.awayTeamId) continue; // stat line for a team not in this match
      if (teamId && raw.teamId !== teamId) continue;

      if (!players.has(playerId)) {
        players.set(playerId, {
          playerId, teamIds: [], matches: 0, sets: 0, wins: 0, mvps: 0, totals: emptyTotals(statKeys), log: [],
        });
      }
      const p = players.get(playerId);
      const won = m.winner === (isHome ? 'home' : 'away');
      const mvp = r.mvpPlayerId === playerId;
      const line = {};
      for (const k of statKeys) {
        line[k] = Number(raw[k]) || 0;
        p.totals[k] += line[k];
      }
      p.matches++;
      p.sets += setsInMatch;
      if (won) p.wins++;
      if (mvp) p.mvps++;
      if (!p.teamIds.includes(raw.teamId)) p.teamIds.push(raw.teamId);
      p.log.push({
        fixtureId: m.fixtureId,
        round: m.round,
        scheduledAt: m.scheduledAt,
        teamId: raw.teamId,
        opponentId: isHome ? m.awayTeamId : m.homeTeamId,
        won,
        setsFor: isHome ? m.homeSets : m.awaySets,
        setsAgainst: isHome ? m.awaySets : m.homeSets,
        mvp,
        line,
      });
    }
  }
  return players;
}

// Per-match and per-set averages for anything with { matches, sets, totals }.
export function rates(entry, statKeys) {
  const perMatch = {};
  const perSet = {};
  for (const k of statKeys) {
    perMatch[k] = entry.matches ? entry.totals[k] / entry.matches : 0;
    perSet[k] = entry.sets ? entry.totals[k] / entry.sets : 0;
  }
  return { perMatch, perSet };
}

// Team totals: every player stat added up, plus matches and sets played.
// Returns Map teamId -> { teamId, matches, sets, totals }
export function seasonTeamStats({ matches, results, statKeys }) {
  const teams = new Map();
  const get = (id) => {
    if (!teams.has(id)) teams.set(id, { teamId: id, matches: 0, sets: 0, totals: emptyTotals(statKeys) });
    return teams.get(id);
  };
  for (const m of matches) {
    const sets = m.homeSets + m.awaySets;
    for (const id of [m.homeTeamId, m.awayTeamId]) {
      const t = get(id);
      t.matches++;
      t.sets += sets;
    }
    const r = results[m.fixtureId];
    for (const raw of Object.values(r?.playerStats ?? {})) {
      if (raw.teamId !== m.homeTeamId && raw.teamId !== m.awayTeamId) continue;
      const t = get(raw.teamId);
      for (const k of statKeys) t.totals[k] += Number(raw[k]) || 0;
    }
  }
  return teams;
}

// Top players for one stat.
// by: 'total' | 'perMatch' | 'perSet'. minMatches keeps one-off games out of the averages.
// Ties: fewer matches ranks higher (did it quicker), then player ID for a stable order.
export function leaders(playerStats, key, { by = 'total', limit = 5, minMatches = 1 } = {}) {
  const value = (p) => {
    if (by === 'perMatch') return p.matches ? p.totals[key] / p.matches : 0;
    if (by === 'perSet') return p.sets ? p.totals[key] / p.sets : 0;
    return p.totals[key];
  };
  return [...playerStats.values()]
    .filter((p) => p.matches >= minMatches && key in p.totals)
    .map((p) => ({ ...p, value: value(p) }))
    .sort((a, b) => b.value - a.value || a.matches - b.matches || a.playerId.localeCompare(b.playerId))
    .slice(0, limit);
}
