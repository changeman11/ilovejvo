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
