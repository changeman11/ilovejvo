// Elo maths for team games.
// - A team's rating is the average of its players' ratings.
// - The usual Elo formula gives each team's expected chance of winning.
// - The winners gain K x (1 - expected); the losers lose the same amount, so points are never
//   created or lost overall. Every player on a team gets the same change.
// JVO settings (2026-10-23): everyone starts at 1000, K = 32.

export const DEFAULT_START = 1000;
export const DEFAULT_K = 32;

// Chance (0-1) that a side rated `ra` beats a side rated `rb`.
export function expectedScore(ra, rb) {
  return 1 / (1 + 10 ** ((rb - ra) / 400));
}

export function average(ratings) {
  if (!ratings.length) throw new Error('A team needs at least one rating');
  return ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
}

// Rating change for each team. `winner` is 'a' or 'b'. Changes are whole numbers.
//   teamDelta([1000, 1000], [1000, 1000], 'a') -> { a: 16, b: -16, expectedA: 0.5 }
export function teamDelta(ratingsA, ratingsB, winner, k = DEFAULT_K) {
  if (winner !== 'a' && winner !== 'b') throw new Error("winner must be 'a' or 'b'");
  const expectedA = expectedScore(average(ratingsA), average(ratingsB));
  const a = Math.round(k * ((winner === 'a' ? 1 : 0) - expectedA)) || 0;
  return { a, b: -a || 0, expectedA };
}
