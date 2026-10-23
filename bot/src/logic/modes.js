// Game modes: a mode is a team size (2 = 2v2 ... 6 = 6v6).
// Each game picks a random mode from the ones that fit how many players are ready.
import { pickOne } from './random.js';

export const ALL_MODES = [2, 3, 4, 5, 6];

export const modeLabel = (size) => `${size}v${size}`;

// "2,3,4,5,6" -> [2, 3, 4, 5, 6]. Sorted, no repeats; sizes 1-10 only.
export function parseModes(text) {
  const sizes = String(text ?? '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  if (!sizes.length || sizes.some((n) => !Number.isInteger(n) || n < 1 || n > 10)) return null;
  return [...new Set(sizes)].sort((a, b) => a - b);
}

// Fewest players needed for any game (the smallest mode), and the most a game can take.
export const minPlayers = (modes) => Math.min(...modes) * 2;
export const maxPlayers = (modes) => Math.max(...modes) * 2;

// Modes that fit `readyCount` players. 9 ready -> 2v2, 3v3, 4v4.
export function fittingModes(readyCount, modes = ALL_MODES) {
  return modes.filter((size) => size * 2 <= readyCount);
}

// A random mode that fits, or null when there aren't enough players for any mode.
export function chooseMode(readyCount, modes = ALL_MODES, rng = Math.random) {
  return pickOne(fittingModes(readyCount, modes), rng) ?? null;
}

// Votes: { size: count } from players who are signed up. Only modes that fit count.
export function tallyVotes(sizes, readyCount, modes = ALL_MODES) {
  const fit = new Set(fittingModes(readyCount, modes));
  const tally = {};
  for (const s of sizes) if (fit.has(s)) tally[s] = (tally[s] ?? 0) + 1;
  return tally;
}

// The next game's mode:
// - an admin-set mode wins (null if there aren't enough players for it yet);
// - otherwise the most-voted mode that fits, if it has at least `needed` votes (ties: random);
// - otherwise a random mode that fits.
//   -> { size, by: 'admin' | 'votes' | 'random', votes } or null
export function pickMode({ readyCount, modes = ALL_MODES, votes = [], needed = 2, fixed = null, rng = Math.random }) {
  if (fixed) return readyCount >= fixed * 2 ? { size: fixed, by: 'admin', votes: 0 } : null;
  const tally = tallyVotes(votes, readyCount, modes);
  const top = Math.max(0, ...Object.values(tally));
  if (top >= needed) {
    const tied = Object.keys(tally).filter((s) => tally[s] === top).map(Number);
    return { size: pickOne(tied, rng), by: 'votes', votes: top };
  }
  const size = chooseMode(readyCount, modes, rng);
  return size ? { size, by: 'random', votes: 0 } : null;
}
