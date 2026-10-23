// Player rating records and how a game result changes them.
// A record (stored as pickupRatings/{discordId}):
//   { discordId, name, rating, games, wins, losses, form, lastGameAt, updatedAt }
// `form` is the last 5 results, oldest first, e.g. 'WWLWL'.
import { teamDelta } from './elo.js';

export function newRecord(discordId, name, start) {
  return { discordId, name: name ?? '', rating: start, games: 0, wins: 0, losses: 0, form: '' };
}

// Rating changes for every real player in a finished game (pretend test players are skipped).
// ratingOf(player) gives the rating to use for that player before this game.
//   -> { [discordId]: { side, won, before, delta } }
export function gameChanges(game, winner, ratingOf, k) {
  const ratings = (side) => game.teams[side].players.map((p) => ratingOf(p));
  const delta = teamDelta(ratings('a'), ratings('b'), winner, k);
  const changes = {};
  for (const side of ['a', 'b']) {
    for (const p of game.teams[side].players) {
      if (p.fake) continue;
      changes[p.id] = { side, won: side === winner, before: ratingOf(p), delta: delta[side] };
    }
  }
  return changes;
}

export function applyChange(record, change, at, name) {
  const letter = change.won ? 'W' : 'L';
  return {
    ...record,
    name: name || record.name,
    rating: record.rating + change.delta,
    games: record.games + 1,
    wins: record.wins + (change.won ? 1 : 0),
    losses: record.losses + (change.won ? 0 : 1),
    form: (record.form + letter).slice(-5),
    lastGameAt: at,
    updatedAt: at,
  };
}

// Undo a change (used when an admin corrects or cancels a result).
export function revertChange(record, change, at) {
  const letter = change.won ? 'W' : 'L';
  const i = record.form.lastIndexOf(letter);
  return {
    ...record,
    rating: record.rating - change.delta,
    games: Math.max(0, record.games - 1),
    wins: Math.max(0, record.wins - (change.won ? 1 : 0)),
    losses: Math.max(0, record.losses - (change.won ? 0 : 1)),
    form: i === -1 ? record.form : record.form.slice(0, i) + record.form.slice(i + 1),
    updatedAt: at,
  };
}

// Players with at least one game, best first (rating, then wins, then name).
export function ranked(records) {
  return records
    .filter((r) => r.games > 0)
    .sort((x, y) => y.rating - x.rating || y.wins - x.wins || x.name.localeCompare(y.name));
}
