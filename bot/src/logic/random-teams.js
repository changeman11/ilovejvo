// Random teams (added 2026-10-25): instead of the captains' draft, players can vote for random
// teams. More than half of a game's players voting for it = no draft, the teams are shuffled.
// Votes are made while signed up (queue card / website) and can be added on the draft card
// itself. Pure functions (tested).
import { shuffle } from './random.js';

// Votes needed for a game of `count` players: more than half (4 players -> 3, 8 -> 5, 12 -> 7).
export const randomNeeded = (count) => Math.floor(count / 2) + 1;

// A finished draft state (same shape as logic/draft.js createDraft) with random teams.
// captains: keep these two as captains (one per team, e.g. mid-draft); otherwise the first
// player shuffled onto each team is its captain (they report the result).
export function randomTeams({ players, size, captains = null, rng = Math.random }) {
  if (players.length !== size * 2) throw new Error(`A ${size}v${size} needs ${size * 2} players, got ${players.length}`);
  const rest = shuffle(players.filter((p) => p !== captains?.a && p !== captains?.b), rng);
  let a;
  let b;
  if (captains) {
    a = [captains.a, ...rest.slice(0, size - 1)];
    b = [captains.b, ...rest.slice(size - 1)];
  } else {
    a = rest.slice(0, size);
    b = rest.slice(size);
  }
  return {
    size,
    players: [...players],
    captains: { a: a[0], b: b[0] },
    teams: { a, b },
    pool: [],
    order: [],
    turn: 0,
    first: 'a',
    autoLast: null,
    random: true,
  };
}
