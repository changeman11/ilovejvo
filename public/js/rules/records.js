// Awards, records and milestones, all worked out from results every time. Nothing is stored.
// Pure functions, no Firebase.
//
// `seasons` below is a list of season bundles, oldest first:
//   [{ season, fixtures, results, teams, ... }]   (what data.js loadAllSeasons() returns)

import { AWARD_NAMES, MILESTONES } from './defaults.js';
import { seasonMatches } from './season.js';
import { seasonPlayerStats } from './stats.js';
import { computeStandings } from './standings.js';
import { resolveBracket } from './playoffs.js';

// Award categories: one per stat, plus most match MVPs.
function categories(statDefs) {
  return [
    ...statDefs.map((s) => ({ key: s.key, label: s.label, statName: s.name, value: (p) => p.totals[s.key] ?? 0 })),
    { key: 'mvps', label: 'MVP', statName: 'Match MVPs', value: (p) => p.mvps },
  ];
}

// ---------- Live awards ----------

// One prize per stat. Whoever is #1 right now holds it; ties are joint holders.
// Returns [{ key, prize, label, statName, holders: [entry], board: [entry] }]
//   entry = { playerId, teamId, value, matches }
export function statAwards(playerStats, statDefs, { limit = 5 } = {}) {
  return categories(statDefs).map((c) => {
    const board = [...playerStats.values()]
      .map((p) => ({ playerId: p.playerId, teamId: p.log[p.log.length - 1]?.teamId ?? null, value: c.value(p), matches: p.matches }))
      .filter((e) => e.value > 0)
      .sort((a, b) => b.value - a.value || a.matches - b.matches || a.playerId.localeCompare(b.playerId));
    const top = board[0]?.value ?? 0;
    return {
      key: c.key,
      prize: AWARD_NAMES[c.key] ?? `Most ${c.statName}`,
      label: c.label,
      statName: c.statName,
      holders: board.filter((e) => e.value === top),
      board: board.slice(0, limit),
    };
  });
}

// Everything a season hands out: champions, minor premiers and the stat awards.
// `settled` flags say whether each honour is final yet.
export function seasonHonours(bundle) {
  const { season, fixtures, results } = bundle;
  const { rows } = computeStandings(bundle);
  const { matches } = seasonMatches(bundle);
  const statDefs = season.stats ?? [];
  const players = seasonPlayerStats({ matches, results, statKeys: statDefs.map((s) => s.key) });
  const bracket = resolveBracket(season, fixtures, results);
  const finished = ['finished', 'locked'].includes(season.status);
  const regularDone = fixtures.filter((f) => f.stage !== 'playoffs').every((f) => results[f.id]);
  return {
    seasonId: season.id,
    seasonName: season.name,
    finished,
    premiersId: rows[0]?.played ? rows[0].teamId : null,
    premiersSettled: regularDone,
    championId: bracket?.championId ?? null,
    awards: statAwards(players, statDefs),
  };
}

// ---------- Records ----------

// All-time records, walking every match in order (so on a tie, whoever got there first keeps it).
// statDefs: the stat list to use (normally the latest season's).
// Returns { match, season, career, team, careerTotals }
//   match[key]  = { value, playerId, teamId, opponentId, seasonId, fixtureId }   best single match
//   season[key] = { value, playerId, seasonId }                                  best single season
//   career[key] = { value, playerId }                                            best career total
//   team = { biggestWin, highestSet, longestStreak, mostTablePoints }
export function allTimeRecords(seasons, statDefs) {
  const keys = statDefs.map((s) => s.key);
  const match = {};
  const seasonBest = {};
  const careerTotals = new Map();
  const team = { biggestWin: null, highestSet: null, longestStreak: null, mostTablePoints: null };
  const streaks = new Map();

  for (const bundle of seasons) {
    const seasonId = bundle.season.id;
    const { matches } = seasonMatches(bundle);

    for (const m of matches) {
      const r = bundle.results[m.fixtureId];
      const at = { seasonId, fixtureId: m.fixtureId };

      for (const [playerId, line] of Object.entries(r.playerStats ?? {})) {
        if (line.teamId !== m.homeTeamId && line.teamId !== m.awayTeamId) continue;
        const opponentId = line.teamId === m.homeTeamId ? m.awayTeamId : m.homeTeamId;
        for (const k of keys) {
          const v = Number(line[k]) || 0;
          if (v > 0 && v > (match[k]?.value ?? 0)) match[k] = { value: v, playerId, teamId: line.teamId, opponentId, ...at };
        }
      }

      if (!m.forfeit) {
        const margin = Math.abs(m.homePoints - m.awayPoints);
        if (margin > (team.biggestWin?.margin ?? 0)) {
          const homeWon = m.winner === 'home';
          team.biggestWin = {
            margin,
            winnerId: homeWon ? m.homeTeamId : m.awayTeamId,
            loserId: homeWon ? m.awayTeamId : m.homeTeamId,
            score: homeWon ? `${m.homePoints}–${m.awayPoints}` : `${m.awayPoints}–${m.homePoints}`,
            ...at,
          };
        }
        for (const s of r.sets) {
          const total = s.home + s.away;
          if (total > (team.highestSet?.total ?? 0)) {
            team.highestSet = { total, home: s.home, away: s.away, homeTeamId: m.homeTeamId, awayTeamId: m.awayTeamId, ...at };
          }
        }
      }

      // Winning streaks run across seasons (and include forfeit wins).
      for (const [teamId, won] of [[m.homeTeamId, m.winner === 'home'], [m.awayTeamId, m.winner === 'away']]) {
        const prev = streaks.get(teamId);
        const cur = won ? { length: (prev?.length ?? 0) + 1, from: prev?.length ? prev.from : at } : { length: 0 };
        streaks.set(teamId, cur);
        if (won && cur.length > (team.longestStreak?.length ?? 0)) team.longestStreak = { length: cur.length, teamId, from: cur.from, to: at };
      }
    }

    // Season and career totals.
    const players = seasonPlayerStats({ matches, results: bundle.results, statKeys: keys });
    for (const p of players.values()) {
      const values = { ...p.totals, mvps: p.mvps };
      for (const k of [...keys, 'mvps']) {
        if (values[k] > 0 && values[k] > (seasonBest[k]?.value ?? 0)) seasonBest[k] = { value: values[k], playerId: p.playerId, seasonId };
      }
      if (!careerTotals.has(p.playerId)) {
        careerTotals.set(p.playerId, { playerId: p.playerId, matches: 0, sets: 0, wins: 0, mvps: 0, totals: Object.fromEntries(keys.map((k) => [k, 0])) });
      }
      const c = careerTotals.get(p.playerId);
      c.matches += p.matches;
      c.sets += p.sets;
      c.wins += p.wins;
      c.mvps += p.mvps;
      for (const k of keys) c.totals[k] += p.totals[k] ?? 0;
    }

    const { rows } = computeStandings(bundle);
    if (rows[0] && rows[0].points > (team.mostTablePoints?.points ?? 0)) {
      team.mostTablePoints = { points: rows[0].points, teamId: rows[0].teamId, played: rows[0].played, seasonId };
    }
  }

  const career = {};
  for (const c of careerTotals.values()) {
    const values = { ...c.totals, mvps: c.mvps, matches: c.matches };
    for (const k of [...keys, 'mvps', 'matches']) {
      if (values[k] > 0 && values[k] > (career[k]?.value ?? 0)) career[k] = { value: values[k], playerId: c.playerId };
    }
  }

  return { match, season: seasonBest, career, team, careerTotals };
}

// ---------- Milestones ----------

const ladderFor = (key, ladders) => ladders[key] ?? ladders.default;

// Every career milestone reached, newest first: { playerId, key, threshold, seasonId, fixtureId, at }
// key 'matches' = matches played.
export function milestonesReached(seasons, statDefs, ladders = MILESTONES) {
  const keys = statDefs.map((s) => s.key);
  const running = new Map();
  const events = [];

  for (const bundle of seasons) {
    const { matches } = seasonMatches(bundle);
    for (const m of matches) {
      const r = bundle.results[m.fixtureId];
      for (const [playerId, line] of Object.entries(r.playerStats ?? {})) {
        if (line.teamId !== m.homeTeamId && line.teamId !== m.awayTeamId) continue;
        if (!running.has(playerId)) running.set(playerId, { matches: 0, ...Object.fromEntries(keys.map((k) => [k, 0])) });
        const t = running.get(playerId);
        const add = { matches: 1, ...Object.fromEntries(keys.map((k) => [k, Number(line[k]) || 0])) };
        for (const [k, v] of Object.entries(add)) {
          const before = t[k];
          t[k] = before + v;
          for (const threshold of ladderFor(k, ladders)) {
            if (before < threshold && t[k] >= threshold) {
              events.push({ playerId, key: k, threshold, seasonId: bundle.season.id, fixtureId: m.fixtureId, at: m.scheduledAt ?? null });
            }
          }
        }
      }
    }
  }
  return { events: events.reverse(), running };
}

// "Record watch": players close to their next milestone, or close to a career record.
// within: how close counts (0.15 = within 15%).
export function recordWatch(running, careerRecords, statDefs, { ladders = MILESTONES, within = 0.15, limit = 12 } = {}) {
  const keys = [...statDefs.map((s) => s.key), 'matches'];
  const items = [];
  for (const [playerId, totals] of running) {
    for (const k of keys) {
      const total = totals[k] ?? 0;
      const next = ladderFor(k, ladders).find((t) => t > total);
      if (next && total > 0) {
        const need = next - total;
        if (need <= Math.max(3, Math.ceil(next * within))) items.push({ type: 'milestone', playerId, key: k, total, target: next, need });
      }
      const rec = careerRecords[k];
      if (rec && rec.playerId !== playerId && total > 0 && total >= rec.value * (1 - within)) {
        items.push({ type: 'record', playerId, key: k, total, target: rec.value + 1, need: rec.value + 1 - total, holderId: rec.playerId });
      }
    }
  }
  return items.sort((a, b) => a.need / a.target - b.need / b.target).slice(0, limit);
}
