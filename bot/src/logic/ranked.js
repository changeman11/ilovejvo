// 1v1 ranked RP. Everyone starts at 1000. The first PLACEMENT_GAMES (5) games are placements,
// worth ±50 each, so players land between 750 and 1250; after that every game is ±20.
// Records look like pickup ratings (logic/ratings.js): { discordId, name, rating, games, wins, losses, form }.

export const RP_START = 1000;
export const PLACEMENT_GAMES = 5;
export const PLACEMENT_STEP = 50;
export const RP_STEP = 20;

export const isPlaced = (record) => (record?.games ?? 0) >= PLACEMENT_GAMES;

// How much this game moves this player's RP (before it's played).
export function rpDelta(record, won) {
  const step = isPlaced(record) ? RP_STEP : PLACEMENT_STEP;
  return won ? step : -step;
}

// Both players report who won ('a' or 'b'). -> { status: 'waiting' | 'agreed' | 'disputed', winner? }
export function tallyReports(reports = {}) {
  const a = reports.a?.winner;
  const b = reports.b?.winner;
  if (!a || !b) return { status: 'waiting' };
  if (a === b) return { status: 'agreed', winner: a };
  return { status: 'disputed' };
}

// "Placing 3/5" until placed, then the RP.
export function rpLabel(record) {
  if (!record?.games) return 'unranked';
  return isPlaced(record) ? `${record.rating} RP` : `placing ${record.games}/${PLACEMENT_GAMES} (${record.rating} RP)`;
}
