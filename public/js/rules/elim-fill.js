// "Fill in the next matches" for elimination tournaments run by hand (added 2026-10-26; byes and
// the admin's own numbering 2026-10-26). Admins make some matches themselves; this works out the rest:
//  - the current round: teams due in it that aren't in a match yet are paired up, except the ones
//    the admin gives a bye (byes are saved on the event: event.elimByes = { round: [teamIds] });
//    an odd one out also gets a bye;
//  - once a round has all its scores: the next round, from the winners and the byes.
//  - Double elimination (needs round labels, rules/bracket-labels.js): upper losers drop to the
//    lower bracket, then the Grand Final, and a Grand Final Reset if the lower team wins it.
// Labels: if the admin numbers matches ("1", "2", ...), new ones carry on the numbers and rounds are
// told apart by order (a new round starts when a team plays again). Otherwise "<round> · Match n".
// Existing matches are never renamed. Pure, tested.
import { elimRound } from './bracket-labels.js';

const numberOnly = (label) => !String(label ?? '').trim() || /^#?\d+$/.test(String(label).trim());

function upperName(kind, teams, index) {
  const named = { 2: 'Final', 4: 'Semi-final', 8: 'Quarter-final', 16: 'Round of 16' };
  if (kind === 'double') return teams === 2 ? 'Upper Final' : teams === 4 && index > 0 ? 'Upper Semi-final' : `Upper Round ${index + 1}`;
  return index > 0 ? named[teams] ?? `Round ${index + 1}` : `Round ${index + 1}`;
}

function pairUp(ids) {
  const pairs = [];
  for (let i = 0; i + 1 < ids.length; i += 2) pairs.push([ids[i], ids[i + 1]]);
  return { pairs, bye: ids.length % 2 ? ids[ids.length - 1] : null };
}

function shuffle(ids, seed) {
  const h = (s) => { let x = 2166136261; for (const c of s) x = Math.imul(x ^ c.charCodeAt(0), 16777619); return x >>> 0; };
  return [...ids].sort((a, b) => h(seed + a) - h(seed + b) || (a < b ? -1 : 1));
}

// kind: 'single' | 'double'. fixtures: saved fixtures. teamIds: the event's teams.
// outcome(f) -> { winner, loser } | null. byes: saved { roundName: [teamIds] }.
// giveByes: teams the admin ticked for a bye in the round being filled now.
// -> { add: [{ label, homeTeamId, awayTeamId }], byes: {...} (to save), pending: { round, free } | null,
//      notes: [text], done: bool, problem: text | null }
export function fillElimination({ kind = 'single', fixtures, teamIds, outcome, seed = '', byes = {}, giveByes = [] }) {
  const real = [...fixtures].filter((f) => !f.virtual && f.homeTeamId && f.awayTeamId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const numbered = real.length > 0 && real.every((f) => numberOnly(f.label));
  const saveByes = Object.fromEntries(Object.entries(byes ?? {}).map(([k, v]) => [k, [...(v ?? [])]]));
  const notes = [];
  const add = [];
  if (numbered && kind === 'double') {
    return { add, byes: saveByes, pending: null, notes, done: false, problem: 'Double elimination needs round names (Upper / Lower) on the matches. Pick a Round when adding matches, or use single elimination.' };
  }

  // Which round each fixture is in.
  const roundOf = new Map();
  if (numbered) {
    // By order: a new round starts when a team that already played in this round shows up again.
    let i = 0;
    // A team with a bye in this round can't play in it either.
    let seen = new Set(saveByes['Round 1'] ?? []);
    for (const f of real) {
      if (seen.has(f.homeTeamId) || seen.has(f.awayTeamId)) { i++; seen = new Set(saveByes[`Round ${i + 1}`] ?? []); }
      seen.add(f.homeTeamId); seen.add(f.awayTeamId);
      roundOf.set(f.id, `Round ${i + 1}`);
    }
  } else {
    const firstUpper = kind === 'double' ? 'Upper Round 1' : 'Round 1';
    for (const f of real) roundOf.set(f.id, elimRound(f.label) ?? (numberOnly(f.label) ? firstUpper : null));
  }
  let nextNumber = Math.max(0, ...real.map((f) => Number(String(f.label ?? '').replace('#', '')) || 0));

  const order = [];
  for (const f of real) { const r = roundOf.get(f.id); if (r && !order.includes(r)) order.push(r); }
  const matchesIn = (name) => real.filter((f) => roundOf.get(f.id) === name);
  const countIn = (name) => matchesIn(name).length + add.filter((a) => a.round === name).length;
  const label = (name) => {
    if (numbered) return String(++nextNumber);
    return /(Final|3rd place match)$/.test(name) && !/Semi-final$|Quarter-final$/.test(name) ? name : `${name} · Match ${countIn(name) + 1}`;
  };
  const make = (name, pairs) => { for (const [h, a] of pairs) add.push({ round: name, label: label(name), homeTeamId: h, awayTeamId: a }); };
  const byeOf = (name) => saveByes[name] ?? [];
  let pending = null;

  // Fill one round: pair the free teams, apart from the ticked byes (an odd one out gets a bye too).
  const fillRound = (name, free) => {
    const chosen = free.filter((t) => giveByes.includes(t));
    const rest = free.filter((t) => !chosen.includes(t));
    const { pairs, bye } = pairUp(rest);
    make(name, pairs);
    const newByes = [...chosen, ...(bye ? [bye] : [])];
    if (newByes.length) {
      saveByes[name] = [...new Set([...byeOf(name), ...newByes])];
      notes.push(`bye${newByes.length === 1 ? '' : 's'} in ${name}: ${newByes.length} team${newByes.length === 1 ? '' : 's'} go straight through`);
    }
  };

  // ---- Upper (or only) bracket ----
  const isUpper = (name) => name && !/^Lower|^Grand Final|^3rd place/.test(name);
  const upperRounds = order.filter(isUpper);
  if (!upperRounds.length) upperRounds.push(kind === 'double' ? 'Upper Round 1' : 'Round 1');
  const upper = [];
  let entrants = shuffle(teamIds, seed);
  for (let i = 0; i < upperRounds.length; i++) {
    const name = upperRounds[i];
    const ms = matchesIn(name);
    const placed = new Set([...ms.flatMap((f) => [f.homeTeamId, f.awayTeamId]), ...byeOf(name)]);
    const free = entrants.filter((t) => !placed.has(t));
    const results = ms.map(outcome);
    const complete = free.length === 0 && results.every(Boolean);
    const advance = [...results.filter(Boolean).map((r) => r.winner), ...byeOf(name).filter((t) => entrants.includes(t))];
    upper.push({ name, free, complete, advance, losers: results.filter(Boolean).map((r) => r.loser) });
    entrants = advance;
  }
  const lastU = upper[upper.length - 1];
  if (lastU.free.length) {
    pending = { round: lastU.name, free: lastU.free };
    if (lastU.free.length >= 2 || giveByes.some((t) => lastU.free.includes(t))) fillRound(lastU.name, lastU.free);
    else { saveByes[lastU.name] = [...byeOf(lastU.name), ...lastU.free]; notes.push(`a bye in ${lastU.name}`); }
  } else if (lastU.complete && lastU.advance.length >= 2) {
    const name = upperName(kind, lastU.advance.length, upper.length);
    const roundName = numbered ? `Round ${upper.length + 1}` : name;
    pending = { round: roundName, free: lastU.advance };
    fillRound(roundName, lastU.advance);
    upper.push({ name: roundName, pending: true });
  }
  const upperChamp = lastU.complete && lastU.advance.length === 1 && !upper.some((u) => u.pending) ? lastU.advance[0] : null;

  if (kind !== 'double') {
    return { add: add.map(({ round, ...m }) => m), byes: saveByes, pending, notes, done: Boolean(upperChamp), problem: null };
  }

  // ---- Lower bracket (double elimination) ----
  const lowerRounds = order.filter((r) => /^Lower /.test(r));
  let pool = null;
  let lowerChamp = null;
  let lastLower = null;
  for (let j = 0; ; j++) {
    const fromUpper = upper[j] && !upper[j].pending ? upper[j] : null;
    if (j === 0) {
      if (!fromUpper?.complete) break;
      pool = [...fromUpper.losers];
    } else {
      if (!lastLower?.complete) break;
      const dropping = fromUpper ? (fromUpper.complete ? fromUpper.losers : null) : [];
      if (dropping === null) break;
      pool = [...lastLower.advance, ...dropping];
    }
    if (!pool.length) break;
    const upperDone = Boolean(upperChamp) && !upper[j + 1];
    if (pool.length === 1 && upperDone) { lowerChamp = pool[0]; break; }
    const name = lowerRounds[j] ?? (pool.length === 2 && upperDone ? 'Lower Final' : `Lower Round ${j + 1}`);
    const ms = matchesIn(name);
    const placed = new Set([...ms.flatMap((f) => [f.homeTeamId, f.awayTeamId]), ...byeOf(name)]);
    const free = pool.filter((t) => !placed.has(t));
    const results = ms.map(outcome);
    if (free.length) {
      if (!pending) pending = { round: name, free };
      if (free.length >= 2 || giveByes.some((t) => free.includes(t))) fillRound(name, free);
      else { saveByes[name] = [...byeOf(name), ...free]; notes.push(`a bye in ${name}`); }
      break;
    }
    const complete = results.every(Boolean);
    lastLower = { name, complete, advance: [...results.filter(Boolean).map((r) => r.winner), ...byeOf(name).filter((t) => pool.includes(t))] };
    if (!complete) break;
    if (upperDone && lastLower.advance.length === 1) { lowerChamp = lastLower.advance[0]; break; }
  }

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
  const done = real.some((f) => roundOf.get(f.id) === 'Grand Final Reset' && outcome(f))
    || real.some((f) => roundOf.get(f.id) === 'Grand Final' && outcome(f)?.winner === upperChamp);
  return { add: add.map(({ round, ...m }) => m), byes: saveByes, pending, notes, done, problem: null };
}

// What's waiting to be filled, for the admin's bye checkboxes (no dice rolled, nothing saved).
export function pendingRound(args) {
  return fillElimination({ ...args, giveByes: [] }).pending;
}

// ---------- Drawing a hand-made bracket (event page, Fixtures page; added 2026-10-26) ----------
// Which bracket view an event gets: event.bracketView 'single' | 'double' | 'off', or (missing /
// 'auto') worked out: Upper/Lower/Grand Final labels = double; other elimination round labels, or
// saved byes = single; otherwise none. Events with an automatic knockout use their own bracket.
export function elimView(event, fixtures) {
  const set = event?.bracketView;
  if (set === 'off') return null;
  if (set === 'single' || set === 'double') return set;
  const real = fixtures.filter((f) => !f.virtual);
  if (real.some((f) => f.stage === 'playoffs')) return null;
  if (real.some((f) => /^(Upper|Lower) |^Grand Final/i.test(String(f.label ?? '')))) return 'double';
  if (real.some((f) => elimRound(f.label)) || Object.values(event?.elimByes ?? {}).some((v) => v?.length)) return 'single';
  return null;
}

// The bracket as rounds: { upper: [{ name, matches, byes }], lower: [...], grand: [matches], other: [matches] }.
// Rounds as the fill button sees them (plain numbers: a new round starts when a team plays again).
export function elimBracket({ kind = 'single', fixtures, byes = {} }) {
  const real = [...fixtures].filter((f) => !f.virtual && f.homeTeamId && f.awayTeamId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const numbered = real.length > 0 && real.every((f) => numberOnly(f.label));
  const roundOf = new Map();
  if (numbered) {
    let i = 0;
    let seen = new Set(byes?.['Round 1'] ?? []);
    for (const f of real) {
      if (seen.has(f.homeTeamId) || seen.has(f.awayTeamId)) { i++; seen = new Set(byes?.[`Round ${i + 1}`] ?? []); }
      seen.add(f.homeTeamId); seen.add(f.awayTeamId);
      roundOf.set(f.id, `Round ${i + 1}`);
    }
  } else {
    const firstUpper = kind === 'double' ? 'Upper Round 1' : 'Round 1';
    for (const f of real) roundOf.set(f.id, elimRound(f.label) ?? (numberOnly(f.label) ? firstUpper : null));
  }
  const order = [];
  for (const f of real) { const r = roundOf.get(f.id); if (r && !order.includes(r)) order.push(r); }
  for (const r of Object.keys(byes ?? {})) if (!order.includes(r)) order.push(r);
  const round = (name) => ({ name, matches: real.filter((f) => roundOf.get(f.id) === name), byes: byes?.[name] ?? [] });
  const isGrand = (n) => /^Grand Final/.test(n);
  return {
    upper: order.filter((n) => !/^Lower /.test(n) && !isGrand(n) && !/^3rd place/.test(n)).map(round),
    lower: order.filter((n) => /^Lower /.test(n)).map(round),
    grand: order.filter(isGrand).flatMap((n) => round(n).matches),
    third: order.filter((n) => /^3rd place/.test(n)).flatMap((n) => round(n).matches),
    other: real.filter((f) => !roundOf.get(f.id)),
  };
}
