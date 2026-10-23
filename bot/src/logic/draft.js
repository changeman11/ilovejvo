// The captains' draft. Two random players become captains (one per team). A coin flip decides
// who picks first, then they take turns picking from the pool. The last player left goes to
// the team that still needs one, without a click.
//
// The draft is plain data, and applyPick returns a new copy, so it's easy to test and to show.
//   { size, players, captains: {a, b}, teams: {a: [...ids], b: [...ids]}, pool: [...ids],
//     order: ['a', 'b', ...], turn, first, autoLast }
import { shuffle } from './random.js';

export const other = (side) => (side === 'a' ? 'b' : 'a');

// Two different random players.
export function pickCaptains(players, rng = Math.random) {
  if (players.length < 2) throw new Error('Need at least two players to pick captains');
  const [a, b] = shuffle(players, rng);
  return { a, b };
}

// Who picks at each turn. Each team needs size - 1 picks (the captain is already in),
// so there are size * 2 - 2 turns. The very last one is filled automatically.
//   alternate: A B A B A B ...
//   snake:     A B B A A B B ...
export function pickOrder(size, first = 'a', style = 'alternate') {
  const second = other(first);
  const turns = size * 2 - 2;
  const order = [];
  for (let i = 0; i < turns; i++) {
    if (style === 'snake') order.push(i === 0 || Math.floor((i - 1) / 2) % 2 === 1 ? first : second);
    else order.push(i % 2 === 0 ? first : second);
  }
  return order;
}

export function createDraft({ players, size, rng = Math.random, style = 'alternate' }) {
  if (!Number.isInteger(size) || size < 1) throw new Error('Bad team size');
  if (players.length !== size * 2) throw new Error(`A ${size}v${size} needs ${size * 2} players, got ${players.length}`);
  if (new Set(players).size !== players.length) throw new Error('A player is listed twice');
  const captains = pickCaptains(players, rng);
  const first = rng() < 0.5 ? 'a' : 'b';
  const draft = {
    size,
    players: [...players],
    captains,
    teams: { a: [captains.a], b: [captains.b] },
    pool: players.filter((p) => p !== captains.a && p !== captains.b),
    order: pickOrder(size, first, style),
    turn: 0,
    first,
    autoLast: null,
  };
  return fillLast(draft);
}

// The side ('a' or 'b') whose captain picks now, or null when the draft is finished.
export function currentSide(draft) {
  return draft.pool.length ? draft.order[draft.turn] : null;
}

export const isComplete = (draft) => draft.pool.length === 0;

// `side` picks `playerId`. Throws if it isn't that side's turn or the player isn't available.
export function applyPick(draft, side, playerId) {
  if (isComplete(draft)) throw new Error('The draft is already finished');
  if (currentSide(draft) !== side) throw new Error("It isn't that captain's turn");
  if (!draft.pool.includes(playerId)) throw new Error("That player can't be picked");
  const next = {
    ...draft,
    teams: { a: [...draft.teams.a], b: [...draft.teams.b] },
    pool: draft.pool.filter((p) => p !== playerId),
    turn: draft.turn + 1,
  };
  next.teams[side].push(playerId);
  return fillLast(next);
}

// When only one player is left there's no choice to make: they join the side whose turn it is.
function fillLast(draft) {
  if (draft.pool.length !== 1) return draft;
  const side = draft.order[draft.turn];
  const last = draft.pool[0];
  return {
    ...draft,
    teams: { ...draft.teams, [side]: [...draft.teams[side], last] },
    pool: [],
    turn: draft.turn + 1,
    autoLast: last,
  };
}
