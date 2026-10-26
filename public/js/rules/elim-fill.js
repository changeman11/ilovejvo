// "Fill in the next matches" for elimination tournaments run by hand (added 2026-10-26). Admins can
// make some matches themselves; this works out the rest from what's there:
//  - the current round: every team due in it that isn't in a match yet is paired up (odd one out
//    gets a bye and goes through);
//  - once a round has all its scores: the next round, from the winners (and byes).
//  - Double elimination: losers of the upper bracket drop to the lower bracket (Lower Round 1 =
//    losers of Upper Round 1; later lower rounds = lower winners + the next upper round's losers),
//    then a Grand Final between the two bracket winners, and a Grand Final Reset if the lower
//    bracket's team wins it.
// Matches with an empty or plain-number label ("1", "2") count as the first round; they're
// relabelled "Round 1 · Match n" / "Upper Round 1 · Match n" so the lists can group them.
// Pure, tested. Labels as in rules/bracket-labels.js.
import { elimRound } from './bracket-labels.js';

const numberOnly = (label) => !String(label ?? '').trim() || /^#?\d+$/.test(String(label).trim());

// The upper (or only) bracket's round name for `teams` teams left in it, the `index`-th round.
function upperName(kind, teams, index) {
  const named = { 2: 'Final', 4: 'Semi-final', 8: 'Quarter-final', 16: 'Round of 16' };
  if (kind === 'double') return teams === 2 ? 'Upper Final' : teams === 4 && index > 0 ? 'Upper Semi-final' : `Upper Round ${index + 1}`;
  return index > 0 || teams <= 16 ? named[teams] ?? `Round ${index + 1}` : `Round ${index + 1}`;
}

// Pairs a list in order: [[a, b], [c, d]], plus the odd one out (bye) or null.
function pairUp(ids) {
  const pairs = [];
  for (let i = 0; i + 1 < ids.length; i += 2) pairs.push([ids[i], ids[i + 1]]);
  return { pairs, bye: ids.length % 2 ? ids[ids.length - 1] : null };
}

// A stable shuffle (same event + teams = same order), so the draw doesn't change on a second press.
function shuffle(ids, seed) {
  const h = (s) => { let x = 2166136261; for (const c of s) x = Math.imul(x ^ c.charCodeAt(0), 16777619); return x >>> 0; };
  return [...ids].sort((a, b) => h(seed + a) - h(seed + b) || (a < b ? -1 : 1));
}

// kind: 'single' | 'double'. fixtures: the event's saved fixtures. teamIds: the event's teams.
// outcome(f) -> { winner, loser } once it has a valid score, else null.
// -> { add: [{ label, homeTeamId, awayTeamId }], relabel: [{ id, label }], notes: [text], done: bool }
export function fillElimination({ kind = 'single', fixtures, teamIds, outcome, seed = '' }) {
  const real = [...fixtures].filter((f) => !f.virtual && f.homeTeamId && f.awayTeamId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const isUpper = (name) => name && !/^Lower|^Grand Final|^3rd place/.test(name);
  const firstUpper = kind === 'double' ? 'Upper Round 1' : 'Round 1';
  // Which round each fixture is in (plain numbers = round 1).
  const roundOf = new Map(real.map((f) => [f.id, elimRound(f.label) ?? (numberOnly(f.label) ? firstUpper : null)]));
  const relabel = [];
  const notes = [];
  const add = [];

  // Rounds in the order they were made.
  const order = [];
  for (const f of real) { const r = roundOf.get(f.id); if (r && !order.includes(r)) order.push(r); }
  const matchesIn = (name) => real.filter((f) => roundOf.get(f.id) === name);
  const countIn = (name) => matchesIn(name).length + add.filter((a) => a.round === name).length;
  const label = (name) => (/(Final|3rd place match)$/.test(name) && !/Semi-final$|Quarter-final$/.test(name) ? name : `${name} · Match ${countIn(name) + 1}`);
  const make = (name, pairs) => { for (const [h, a] of pairs) add.push({ round: name, label: label(name), homeTeamId: h, awayTeamId: a }); };

  // Relabel plain-number first-round matches.
  let n = 0;
  for (const f of real) {
    if (roundOf.get(f.id) === firstUpper && numberOnly(f.label)) relabel.push({ id: f.id, label: `${firstUpper} · Match ${++n}` });
    else if (roundOf.get(f.id) === firstUpper) n++;
  }

  // ---- Upper (or only) bracket ----
  const upperRounds = order.filter(isUpper);
  if (!upperRounds.length) upperRounds.push(firstUpper);
  const upper = []; // [{ name, entrants, placed, complete, advance, losers }]
  let entrants = shuffle(teamIds, seed);
  for (let i = 0; i < upperRounds.length; i++) {
    const name = upperRounds[i];
    const ms = matchesIn(name);
    const placed = new Set(ms.flatMap((f) => [f.homeTeamId, f.awayTeamId]));
    const free = entrants.filter((t) => !placed.has(t));
    const results = ms.map(outcome);
    const complete = free.length <= 1 && results.every(Boolean);
    const advance = [...results.filter(Boolean).map((r) => r.winner), ...free];
    upper.push({ name, entrants, free, complete, advance, losers: results.filter(Boolean).map((r) => r.loser), last: i === upperRounds.length - 1 });
    entrants = advance;
  }
  const lastU = upper[upper.length - 1];
  if (lastU.free.length >= 2) {
    const { pairs, bye } = pairUp(lastU.free);
    make(lastU.name, pairs);
    if (bye) notes.push(`a bye in ${lastU.name}: one team goes straight through`);
  } else if (lastU.complete && lastU.advance.length >= 2) {
    const name = upperName(kind, lastU.advance.length, upper.length);
    const { pairs, bye } = pairUp(lastU.advance);
    make(name, pairs);
    upper.push({ name, entrants: lastU.advance, free: [], complete: false, advance: [], losers: [], pending: true });
    if (bye) notes.push(`a bye in ${name}`);
  }
  const upperChamp = lastU.complete && lastU.advance.length === 1 && !upper.some((u) => u.pending) ? lastU.advance[0] : null;

  if (kind !== 'double') {
    return { add: add.map(({ round, ...m }) => m), relabel, notes, done: Boolean(upperChamp) };
  }

  // ---- Lower bracket (double elimination) ----
  const lowerRounds = order.filter((r) => /^Lower /.test(r));
  let pool = null;
  let lowerChamp = null;
  let lastLower = null;
  for (let j = 0; ; j++) {
    const fromUpper = upper[j] && !upper[j].pending ? upper[j] : null;
    if (j === 0) {
      if (!fromUpper?.complete) break; // Lower Round 1 waits for Upper Round 1's losers
      pool = [...fromUpper.losers];
    } else {
      if (!lastLower?.complete) break;
      const dropping = fromUpper ? (fromUpper.complete ? fromUpper.losers : null) : [];
      if (dropping === null) break; // the next upper round isn't finished: its losers aren't known yet
      pool = [...lastLower.advance, ...dropping];
    }
    if (!pool.length) break;
    const upperDone = Boolean(upperChamp) && !upper[j + 1];
    if (pool.length === 1 && upperDone) { lowerChamp = pool[0]; break; }
    const name = lowerRounds[j] ?? (pool.length === 2 && upperDone ? 'Lower Final' : `Lower Round ${j + 1}`);
    const ms = matchesIn(name);
    const placed = new Set(ms.flatMap((f) => [f.homeTeamId, f.awayTeamId]));
    const free = pool.filter((t) => !placed.has(t));
    const results = ms.map(outcome);
    if (free.length >= 2) {
      const { pairs, bye } = pairUp(free);
      make(name, pairs);
      if (bye) notes.push(`a bye in ${name}`);
      break;
    }
    const complete = free.length <= 1 && results.every(Boolean) && ms.length > 0;
    lastLower = { name, complete, advance: [...results.filter(Boolean).map((r) => r.winner), ...free] };
    if (!complete) break;
    if (upperDone && lastLower.advance.length === 1) { lowerChamp = lastLower.advance[0]; break; }
  }

  // ---- Grand Final (and reset) ----
  if (upperChamp && lowerChamp) {
    const gf = real.filter((f) => roundOf.get(f.id) === 'Grand Final');
    const reset = real.filter((f) => roundOf.get(f.id) === 'Grand Final Reset');
    if (!gf.length) add.push({ round: 'Grand Final', label: 'Grand Final', homeTeamId: upperChamp, awayTeamId: lowerChamp });
    else {
      const r = outcome(gf[0]);
      if (r && r.winner === lowerChamp && !reset.length) {
        add.push({ round: 'Grand Final Reset', label: 'Grand Final Reset', homeTeamId: upperChamp, awayTeamId: lowerChamp });
        notes.push('the lower bracket team won the Grand Final, so it’s reset');
      }
    }
  }
  const finished = real.some((f) => roundOf.get(f.id) === 'Grand Final Reset' && outcome(f))
    || real.some((f) => roundOf.get(f.id) === 'Grand Final' && outcome(f)?.winner === upperChamp);
  return { add: add.map(({ round, ...m }) => m), relabel, notes, done: finished };
}
