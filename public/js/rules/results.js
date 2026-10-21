// Helpers for entering results. Pure functions, no Firebase, so they run in the browser and in tests.

import { DEFAULT_FORMAT } from './defaults.js';
import { checkSet, checkResult, setsToWin } from './match.js';

// Set scores recorded for a forfeit: the minimum sets to win, each won `target`–0.
// JVO: 2–0 with both sets 10–0. Confirm with the league before changing.
// winner: 'home' | 'away'
export function forfeitSets(format = DEFAULT_FORMAT, winner) {
  const sets = [];
  for (let i = 0; i < setsToWin(format); i++) {
    const target = i === format.bestOf - 1 ? format.decidingSetPoints : format.pointsPerSet;
    sets.push(winner === 'home' ? { home: target, away: 0 } : { home: 0, away: target });
  }
  return sets;
}

// How many set rows the entry form should show. Starts at the minimum needed to win
// (2 for best of 3) and adds the next set only while the match is still undecided,
// e.g. the 3rd set appears at 1–1.
export function visibleSetCount(sets, format = DEFAULT_FORMAT) {
  const need = setsToWin(format);
  let rows = need;
  for (;;) {
    let home = 0;
    let away = 0;
    let complete = true;
    for (let i = 0; i < rows; i++) {
      const check = sets[i] ? checkSet(sets[i], i, format) : { ok: false };
      if (!check.ok) { complete = false; break; }
      if (check.winner === 'home') home++;
      else away++;
    }
    if (!complete || home >= need || away >= need || rows >= format.bestOf) return rows;
    rows++;
  }
}

// Turns form text into a clean stat line: whole numbers, never negative, blanks = 0.
export function cleanStatLine(raw, statKeys) {
  const line = {};
  for (const k of statKeys) {
    const n = Math.floor(Number(raw?.[k]));
    line[k] = Number.isFinite(n) && n > 0 ? n : 0;
  }
  return line;
}

// Suggested MVP: the top scorer (pts) on the winning team. Ties go to more spikes, then ID.
export function suggestMvp(playerStats, winnerTeamId) {
  const ranked = Object.entries(playerStats ?? {})
    .filter(([, s]) => s.teamId === winnerTeamId)
    .sort(([aId, a], [bId, b]) => (b.pts ?? 0) - (a.pts ?? 0) || (b.spk ?? 0) - (a.spk ?? 0) || aId.localeCompare(bId));
  return ranked[0]?.[0] ?? null;
}

// "Something to check" notes for a saved or draft result. These don't block saving,
// except that the scores themselves must pass checkResult() (that's an error, not a warning).
// Returns { errors: [...], warnings: [...] }
export function reviewResult(result, { homeTeamId, awayTeamId, format = DEFAULT_FORMAT, teamSize = 4, rosters = {}, teamNames = {} }) {
  const check = checkResult(result?.sets, format);
  const errors = [...check.errors];
  const warnings = [];
  if (result?.forfeit) return { errors, warnings };

  const lines = Object.entries(result?.playerStats ?? {});
  if (!lines.length) {
    warnings.push('No player stats entered');
  } else {
    for (const teamId of [homeTeamId, awayTeamId]) {
      const count = lines.filter(([, s]) => s.teamId === teamId).length;
      if (count !== teamSize) warnings.push(`${count} player${count === 1 ? '' : 's'} entered for ${teamNames[teamId] ?? teamId}, expected ${teamSize}`);
    }
    const strays = lines.filter(([pid, s]) => rosters[s.teamId] && !rosters[s.teamId].playerIds?.includes(pid));
    if (strays.length) warnings.push(`${strays.length} player${strays.length === 1 ? ' isn’t' : 's aren’t'} on their team’s roster`);
  }
  if (!result?.mvpPlayerId) warnings.push('No MVP picked');
  else if (!result.playerStats?.[result.mvpPlayerId]) warnings.push('MVP has no stat line in this match');
  return { errors, warnings };
}
