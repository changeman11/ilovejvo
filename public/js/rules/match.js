// Match rules: checks set scores and works out who won.
// Pure functions, no Firebase, so they run in the browser and in tests.

import { DEFAULT_FORMAT } from './defaults.js';

export function setsToWin(format = DEFAULT_FORMAT) {
  return Math.ceil(format.bestOf / 2);
}

// Is this a finished, legal set score? setIndex is 0-based.
// Returns { ok, winner: 'home' | 'away' | null, error }
export function checkSet(set, setIndex, format = DEFAULT_FORMAT) {
  const home = Number(set?.home);
  const away = Number(set?.away);
  if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) {
    return { ok: false, winner: null, error: `Set ${setIndex + 1}: scores must be whole numbers` };
  }

  const deciding = setIndex === format.bestOf - 1;
  const target = deciding ? format.decidingSetPoints : format.pointsPerSet;
  const winBy = format.winBy ?? 2;
  const cap = format.cap ?? null;

  const hi = Math.max(home, away);
  const lo = Math.min(home, away);
  const winner = home > away ? 'home' : away > home ? 'away' : null;
  const label = `Set ${setIndex + 1} (${home}-${away})`;

  if (!winner) return { ok: false, winner: null, error: `${label}: a set can't end level` };
  if (hi < target) return { ok: false, winner: null, error: `${label}: nobody reached ${target}` };

  if (cap !== null && hi === cap) {
    // Reaching the cap ends the set even on a 1-point lead.
    return { ok: true, winner, error: null };
  }
  if (cap !== null && hi > cap) {
    return { ok: false, winner: null, error: `${label}: score is above the ${cap}-point cap` };
  }
  if (hi - lo < winBy) {
    return { ok: false, winner: null, error: `${label}: must win by ${winBy}` };
  }
  if (hi > target && hi - lo !== winBy) {
    // Past the target score (deuce), the set ends as soon as someone leads by winBy.
    return { ok: false, winner: null, error: `${label}: in deuce the set ends at a ${winBy}-point lead` };
  }
  return { ok: true, winner, error: null };
}

// Checks a whole match. sets = [{ home, away }, ...]
// Returns { ok, errors, homeSets, awaySets, homePoints, awayPoints, winner }
export function checkResult(sets, format = DEFAULT_FORMAT) {
  const errors = [];
  const need = setsToWin(format);
  let homeSets = 0;
  let awaySets = 0;
  let homePoints = 0;
  let awayPoints = 0;

  if (!Array.isArray(sets) || sets.length === 0) {
    return { ok: false, errors: ['No sets entered'], homeSets, awaySets, homePoints, awayPoints, winner: null };
  }
  if (sets.length > format.bestOf) {
    errors.push(`Too many sets: best of ${format.bestOf}`);
  }

  sets.forEach((set, i) => {
    if (homeSets === need || awaySets === need) {
      errors.push(`Set ${i + 1} was entered after the match was already won`);
      return;
    }
    const check = checkSet(set, i, format);
    if (!check.ok) {
      errors.push(check.error);
      return;
    }
    homePoints += Number(set.home);
    awayPoints += Number(set.away);
    if (check.winner === 'home') homeSets++;
    else awaySets++;
  });

  if (errors.length === 0 && homeSets < need && awaySets < need) {
    errors.push(`Match isn't finished: someone needs ${need} sets`);
  }

  const ok = errors.length === 0;
  const winner = ok ? (homeSets > awaySets ? 'home' : 'away') : null;
  return { ok, errors, homeSets, awaySets, homePoints, awayPoints, winner };
}
