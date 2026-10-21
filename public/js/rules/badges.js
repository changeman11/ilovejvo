// Profile badges and levels, earned automatically from results (like Steam badges).
// Nothing is stored: everything is worked out from match results each time.
// Pure functions, no Firebase, so they run in the browser and in tests.

import { MILESTONES } from './defaults.js';

export const STEPS = {
  matches: [1, 10, 25, 50, 100, 200],
  wins: [1, 5, 10, 25, 50, 100],
  mvps: [1, 5, 10, 25, 50],
  events: [3, 5, 10, 20],
  sweeps: [1, 5, 10, 25, 50],
  streak: [3, 5, 10, 15],
  unbeaten: [1, 2, 3, 5],
};

// How many steps a value has passed (0 = none yet).
const reached = (value, steps) => steps.filter((s) => value >= s).length;

// One badge for the highest step reached, or null. Tier 1-5 sets its colour.
function milestone(id, value, steps, title) {
  const n = reached(value, steps);
  if (!n) return null;
  return { id, tier: Math.min(5, n), title: title(steps[n - 1]), value };
}

const byTier = (list) => list.filter(Boolean).sort((a, b) => b.tier - a.tier || b.value - a.value);

// Player badges from a career entry (pages/career.js careerStats): { matches, wins, mvps, totals, log }
// statDefs: [{ key, name }] for the stat milestones.
export function playerBadges(career, statDefs = []) {
  if (!career?.matches) return [];
  const events = new Set(career.log.map((l) => l.eventId)).size;
  const sweeps = career.log.filter((l) => l.won && l.setsAgainst === 0).length;
  return byTier([
    milestone('matches', career.matches, STEPS.matches, (n) => (n === 1 ? 'Debut' : `${n} matches`)),
    milestone('wins', career.wins, STEPS.wins, (n) => (n === 1 ? 'First win' : `${n} wins`)),
    milestone('mvps', career.mvps, STEPS.mvps, (n) => (n === 1 ? 'MVP' : `${n}× MVP`)),
    milestone('events', events, STEPS.events, (n) => `${n} events`),
    milestone('sweeps', sweeps, STEPS.sweeps, (n) => (n === 1 ? 'Clean sweep' : `${n} clean sweeps`)),
    ...statDefs.map((d) => milestone(`stat-${d.key}`, career.totals?.[d.key] ?? 0, MILESTONES.default, (n) => `${n} ${d.name.toLowerCase()}`)),
  ]);
}

// Experience and level, Steam style. Level n needs 25 × n² XP.
export function playerXp(career) {
  if (!career) return 0;
  const sweeps = career.log?.filter((l) => l.won && l.setsAgainst === 0).length ?? 0;
  return career.matches * 10 + career.wins * 15 + career.mvps * 25 + sweeps * 5;
}
export function teamXp(t) {
  if (!t) return 0;
  return t.matches * 10 + t.wins * 15 + t.sweeps * 5 + t.events * 20;
}
export function levelFor(xp) {
  const level = Math.floor(Math.sqrt(Math.max(0, xp) / 25));
  return { level, xp, next: 25 * (level + 1) ** 2, from: 25 * level ** 2 };
}

// Team records across every event.
// eventMatches: [{ eventId, matches }] oldest event first, each `matches` from seasonMatches() (oldest first).
// Returns Map teamId -> { teamId, matches, wins, losses, setsWon, setsLost, pointsWon, pointsLost,
//   events, sweeps, streak, bestStreak, unbeatenEvents, form: ['W'|'L', ...last 5] }
export function teamCareer(eventMatches) {
  const out = new Map();
  const get = (id) => {
    if (!out.has(id)) {
      out.set(id, {
        teamId: id, matches: 0, wins: 0, losses: 0, setsWon: 0, setsLost: 0, pointsWon: 0, pointsLost: 0,
        events: 0, sweeps: 0, streak: 0, bestStreak: 0, unbeatenEvents: 0, form: [],
      });
    }
    return out.get(id);
  };
  for (const { matches } of eventMatches) {
    const perEvent = new Map(); // teamId -> { played, lost }
    for (const m of matches) {
      for (const side of ['home', 'away']) {
        const t = get(side === 'home' ? m.homeTeamId : m.awayTeamId);
        const mine = side === 'home' ? m.homeSets : m.awaySets;
        const theirs = side === 'home' ? m.awaySets : m.homeSets;
        const won = m.winner === side;
        t.matches++;
        t.setsWon += mine;
        t.setsLost += theirs;
        t.pointsWon += side === 'home' ? m.homePoints : m.awayPoints;
        t.pointsLost += side === 'home' ? m.awayPoints : m.homePoints;
        if (won) {
          t.wins++;
          t.streak++;
          t.bestStreak = Math.max(t.bestStreak, t.streak);
          if (theirs === 0) t.sweeps++;
        } else {
          t.losses++;
          t.streak = 0;
        }
        t.form = [...t.form, won ? 'W' : 'L'].slice(-5);
        const e = perEvent.get(t.teamId) ?? { played: 0, lost: 0 };
        e.played++;
        if (!won) e.lost++;
        perEvent.set(t.teamId, e);
      }
    }
    for (const [id, e] of perEvent) {
      const t = get(id);
      t.events++;
      if (e.played >= 3 && e.lost === 0) t.unbeatenEvents++;
    }
  }
  return out;
}

export function teamBadges(t) {
  if (!t?.matches) return [];
  return byTier([
    milestone('matches', t.matches, STEPS.matches, (n) => (n === 1 ? 'First match' : `${n} matches`)),
    milestone('wins', t.wins, STEPS.wins, (n) => (n === 1 ? 'First win' : `${n} wins`)),
    milestone('events', t.events, STEPS.events, (n) => `${n} events`),
    milestone('sweeps', t.sweeps, STEPS.sweeps, (n) => (n === 1 ? 'Clean sweep' : `${n} clean sweeps`)),
    milestone('streak', t.bestStreak, STEPS.streak, (n) => `${n}-win streak`),
    milestone('unbeaten', t.unbeatenEvents, STEPS.unbeaten, (n) => (n === 1 ? 'Unbeaten event' : `${n} unbeaten events`)),
  ]);
}
