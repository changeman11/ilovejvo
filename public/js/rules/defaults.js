// Default rules for a new JVO season. Every season stores its own copy,
// so changing these only affects seasons created afterwards.

// Match format: best of 3, every set first to 10, win by 2 (deuce on, no cap).
export const DEFAULT_FORMAT = {
  teamSize: 4,
  bestOf: 3,
  pointsPerSet: 10,
  decidingSetPoints: 10,
  winBy: 2,
  cap: null, // e.g. 15 = a set ends at 15 even if it's only 15-14
};

// Table points, keyed "setsWon-setsLost" from the team's point of view.
// 2-0 win = 3, 2-1 win = 2, 1-2 loss = 1, 0-2 loss = 0.
export const DEFAULT_STANDINGS = {
  matchPoints: { '2-0': 3, '2-1': 2, '1-2': 1, '0-2': 0 },
  tiebreakers: ['points', 'wins', 'setRatio', 'pointRatio', 'h2h'],
};

// "Win = 1" mode, for seasons that want it.
export const WIN_ONE_STANDINGS = {
  matchPoints: { '2-0': 1, '2-1': 1, '1-2': 0, '0-2': 0 },
  tiebreakers: ['points', 'setRatio', 'pointRatio', 'h2h'],
};

// Player stats as shown on the game's end-of-match screen.
// `label` is the in-game abbreviation. `name` is what the site shows in full.
export const DEFAULT_STATS = [
  { key: 'pts', label: 'PTS', name: 'Points' },
  { key: 'spk', label: 'SPK', name: 'Spikes' },
  { key: 'blk', label: 'BLK', name: 'Blocks' },
  { key: 'rec', label: 'REC', name: 'Receives' },
  { key: 'set', label: 'SET', name: 'Sets' },
  { key: 'ast', label: 'AST', name: 'Assists' },
  { key: 'ace', label: 'ACE', name: 'Aces' },
  { key: 'dig', label: 'DIG', name: 'Digs' },
];

// Table points for a best-of-N format using the 3/2/1/0 pattern
// (clean win 3, close win 2, close loss 1, clean loss 0).
export function fivbMatchPoints(bestOf) {
  const toWin = Math.ceil(bestOf / 2);
  const table = {};
  for (let lost = 0; lost < toWin; lost++) {
    const close = lost === toWin - 1;
    table[`${toWin}-${lost}`] = close ? 2 : 3;
    table[`${lost}-${toWin}`] = close ? 1 : 0;
  }
  return table;
}
