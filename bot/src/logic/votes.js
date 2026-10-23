// Result reports. Each captain says who won ('a' or 'b'), or 'cancel'.
// Both captains must say the same thing before it counts. Admins can decide instead.
export const OUTCOMES = ['a', 'b', 'cancel'];

// votes = { a?: outcome, b?: outcome } (keyed by the captain's own side)
//   -> { status: 'waiting' }                      one or both captains haven't reported
//   -> { status: 'agreed', outcome }              both said the same
//   -> { status: 'disputed' }                     they said different things
export function tallyVotes(votes = {}) {
  const { a, b } = votes;
  if (!OUTCOMES.includes(a) || !OUTCOMES.includes(b)) return { status: 'waiting' };
  if (a === b) return { status: 'agreed', outcome: a };
  return { status: 'disputed' };
}
