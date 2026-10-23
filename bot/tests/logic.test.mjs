import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seeded, shuffle, pickOne } from '../src/logic/random.js';
import { chooseMode, fittingModes, parseModes, minPlayers, maxPlayers, modeLabel } from '../src/logic/modes.js';
import { createDraft, applyPick, currentSide, isComplete, pickOrder, pickCaptains } from '../src/logic/draft.js';
import { expectedScore, teamDelta, average } from '../src/logic/elo.js';
import { tallyVotes } from '../src/logic/votes.js';
import { newRecord, gameChanges, applyChange, revertChange, ranked } from '../src/logic/ratings.js';

const ids = (n) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

// ---------- random ----------
test('seeded random repeats; shuffle keeps every item', () => {
  const a = seeded(7), b = seeded(7);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  const list = ids(10);
  const out = shuffle(list, seeded(1));
  assert.deepEqual([...out].sort(), [...list].sort());
  assert.deepEqual(list, ids(10), 'the original list is untouched');
  assert.equal(pickOne([], seeded(1)), undefined);
});

// ---------- modes ----------
test('modes that fit the number ready', () => {
  assert.deepEqual(fittingModes(3), []);
  assert.deepEqual(fittingModes(4), [2]);
  assert.deepEqual(fittingModes(9), [2, 3, 4]);
  assert.deepEqual(fittingModes(12), [2, 3, 4, 5, 6]);
  assert.deepEqual(fittingModes(30), [2, 3, 4, 5, 6]);
  assert.equal(minPlayers([2, 3, 4, 5, 6]), 4);
  assert.equal(maxPlayers([2, 3, 4, 5, 6]), 12);
  assert.equal(modeLabel(4), '4v4');
});

test('chooseMode only picks modes that fit, and over many games picks each of them', () => {
  assert.equal(chooseMode(3), null);
  const rng = seeded(3);
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const m = chooseMode(9, [2, 3, 4, 5, 6], rng);
    assert.ok([2, 3, 4].includes(m), `9 ready can't play ${m}v${m}`);
    seen.add(m);
  }
  assert.deepEqual([...seen].sort(), [2, 3, 4]);
});

test('parseModes reads a list and rejects nonsense', () => {
  assert.deepEqual(parseModes('2,3,4,5,6'), [2, 3, 4, 5, 6]);
  assert.deepEqual(parseModes(' 6, 2 4 4 '), [2, 4, 6]);
  assert.equal(parseModes(''), null);
  assert.equal(parseModes('2,x'), null);
  assert.equal(parseModes('0'), null);
});

// ---------- draft ----------
test('captains are two different players from the list', () => {
  const players = ids(8);
  for (let s = 0; s < 50; s++) {
    const { a, b } = pickCaptains(players, seeded(s));
    assert.notEqual(a, b);
    assert.ok(players.includes(a) && players.includes(b));
  }
});

test('pick order: alternating A B A B, or snake A B B A', () => {
  assert.deepEqual(pickOrder(2, 'a'), ['a', 'b']);
  assert.deepEqual(pickOrder(4, 'a'), ['a', 'b', 'a', 'b', 'a', 'b']);
  assert.deepEqual(pickOrder(4, 'b'), ['b', 'a', 'b', 'a', 'b', 'a']);
  assert.deepEqual(pickOrder(4, 'a', 'snake'), ['a', 'b', 'b', 'a', 'a', 'b']);
  for (const size of [2, 3, 4, 5, 6]) {
    for (const style of ['alternate', 'snake']) {
      const order = pickOrder(size, 'a', style);
      assert.equal(order.length, size * 2 - 2);
      assert.equal(order.filter((s) => s === 'a').length, size - 1, `${style} ${size}v${size}: each team picks size - 1`);
    }
  }
});

test('a full draft for every mode: right turns, full teams, everyone placed once', () => {
  for (const size of [2, 3, 4, 5, 6]) {
    const rng = seeded(size * 11);
    let d = createDraft({ players: ids(size * 2), size, rng });
    assert.deepEqual(d.teams.a, [d.captains.a]);
    assert.deepEqual(d.teams.b, [d.captains.b]);
    assert.equal(currentSide(d), d.first);
    const seenSides = [];
    while (!isComplete(d)) {
      const side = currentSide(d);
      seenSides.push(side);
      d = applyPick(d, side, d.pool[0]);
    }
    assert.equal(d.teams.a.length, size);
    assert.equal(d.teams.b.length, size);
    assert.deepEqual([...d.teams.a, ...d.teams.b].sort(), ids(size * 2).sort());
    // Turns alternate, and the very last player was placed without a click.
    assert.equal(seenSides.length, size * 2 - 3);
    seenSides.forEach((s, i) => assert.equal(s, i % 2 === 0 ? d.first : (d.first === 'a' ? 'b' : 'a')));
    assert.ok(d.autoLast);
  }
});

test('2v2: one pick, then the last player joins the other team by themselves', () => {
  let d = createDraft({ players: ids(4), size: 2, rng: seeded(5) });
  const side = currentSide(d);
  const [choice, rest] = d.pool;
  d = applyPick(d, side, choice);
  assert.ok(isComplete(d));
  assert.ok(d.teams[side].includes(choice));
  assert.ok(d.teams[side === 'a' ? 'b' : 'a'].includes(rest));
  assert.equal(d.autoLast, rest);
});

test("picks out of turn or of unavailable players are refused, and drafts aren't changed in place", () => {
  const d = createDraft({ players: ids(6), size: 3, rng: seeded(9) });
  const wrong = currentSide(d) === 'a' ? 'b' : 'a';
  assert.throws(() => applyPick(d, wrong, d.pool[0]), /turn/);
  assert.throws(() => applyPick(d, currentSide(d), d.captains.a), /can't be picked/);
  const before = JSON.stringify(d);
  applyPick(d, currentSide(d), d.pool[0]);
  assert.equal(JSON.stringify(d), before);
  assert.throws(() => createDraft({ players: ids(5), size: 3 }), /needs 6/);
  assert.throws(() => createDraft({ players: ['x', 'x', 'y', 'z'], size: 2 }), /twice/);
});

// ---------- Elo ----------
test('Elo: even teams move 16 points with K=32; favourites gain less, underdogs more', () => {
  assert.equal(expectedScore(1000, 1000), 0.5);
  assert.ok(Math.abs(expectedScore(1200, 1000) - 0.7597) < 0.0001);
  assert.deepEqual(teamDelta([1000, 1000], [1000, 1000], 'a', 32), { a: 16, b: -16, expectedA: 0.5 });
  assert.deepEqual(teamDelta([1000, 1000], [1000, 1000], 'b', 32).a, -16);
  const fav = teamDelta([1200, 1200], [1000, 1000], 'a', 32);
  const upset = teamDelta([1200, 1200], [1000, 1000], 'b', 32);
  assert.equal(fav.a, 8);
  assert.equal(upset.b, 24);
  for (const d of [fav, upset]) assert.equal(d.a + d.b, 0, 'zero-sum');
});

test('team rating is the average of the players', () => {
  assert.equal(average([900, 1100, 1000, 1000]), 1000);
  // 1000 + 1200 averages to 1100: same as a team of two 1100s.
  assert.deepEqual(teamDelta([1000, 1200], [1100, 1100], 'a'), teamDelta([1100, 1100], [1100, 1100], 'a'));
  assert.throws(() => average([]));
  assert.throws(() => teamDelta([1000], [1000], 'x'));
});

// ---------- votes ----------
test('both captains must agree', () => {
  assert.equal(tallyVotes({}).status, 'waiting');
  assert.equal(tallyVotes({ a: 'a' }).status, 'waiting');
  assert.deepEqual(tallyVotes({ a: 'b', b: 'b' }), { status: 'agreed', outcome: 'b' });
  assert.deepEqual(tallyVotes({ a: 'cancel', b: 'cancel' }), { status: 'agreed', outcome: 'cancel' });
  assert.equal(tallyVotes({ a: 'a', b: 'b' }).status, 'disputed');
});

// ---------- rating records ----------
const game = {
  teams: {
    a: { captain: 'p1', players: [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }] },
    b: { captain: 'p3', players: [{ id: 'p3', name: 'Three' }, { id: 'test-1', name: 'Test 1', fake: true }] },
  },
};

test('game changes: same change for the whole team; pretend players use the start rating and are skipped', () => {
  const ratings = { p1: 1100, p2: 900, p3: 1000 };
  const changes = gameChanges(game, 'a', (p) => ratings[p.id] ?? 1000, 32);
  assert.deepEqual(Object.keys(changes).sort(), ['p1', 'p2', 'p3']);
  assert.deepEqual(changes.p1, { side: 'a', won: true, before: 1100, delta: 16 });
  assert.equal(changes.p2.delta, 16);
  assert.deepEqual(changes.p3, { side: 'b', won: false, before: 1000, delta: -16 });
});

test('applying and reverting a change', () => {
  const start = newRecord('p1', 'One', 1000);
  const won = applyChange(start, { won: true, delta: 16 }, 5, 'One!');
  assert.deepEqual(won, { discordId: 'p1', name: 'One!', rating: 1016, games: 1, wins: 1, losses: 0, form: 'W', lastGameAt: 5, updatedAt: 5 });
  let r = won;
  for (const w of [false, true, true, false, true]) r = applyChange(r, { won: w, delta: w ? 10 : -10 }, 6);
  assert.equal(r.form, 'LWWLW', 'form keeps the last 5');
  assert.equal(r.games, 6);
  const undone = revertChange(r, { won: true, delta: 10 }, 7);
  assert.equal(undone.rating, r.rating - 10);
  assert.equal(undone.wins, r.wins - 1);
  assert.equal(undone.form, 'LWWL');
  assert.equal(undone.games, 5);
});

test('ranked: players with games only, best first', () => {
  const list = [
    { ...newRecord('a', 'Ann', 1000), games: 3, wins: 2, rating: 1020 },
    { ...newRecord('b', 'Bob', 1000) },
    { ...newRecord('c', 'Cat', 1000), games: 3, wins: 3, rating: 1020 },
    { ...newRecord('d', 'Dan', 1000), games: 1, wins: 0, rating: 984 },
  ];
  assert.deepEqual(ranked(list).map((r) => r.discordId), ['c', 'a', 'd']);
});

// ---------- mode votes ----------
import { pickMode, tallyVotes as tallyModeVotes } from '../src/logic/modes.js';

test('mode votes: a couple of votes pick the mode; votes for modes that do not fit are ignored', () => {
  assert.deepEqual(tallyModeVotes([4, 4, 6, 2], 8), { 4: 2, 2: 1 }, '6v6 needs 12');
  // 2 votes for 3v3 with 8 signed up: 3v3.
  assert.deepEqual(pickMode({ readyCount: 8, votes: [3, 3, 2], needed: 2 }), { size: 3, by: 'votes', votes: 2 });
  // Only 1 vote: random from what fits.
  const r = pickMode({ readyCount: 8, votes: [3], needed: 2, rng: seeded(1) });
  assert.equal(r.by, 'random');
  assert.ok([2, 3, 4].includes(r.size));
  // A tie between two modes: one of them.
  for (let s = 0; s < 20; s++) {
    const t = pickMode({ readyCount: 12, votes: [5, 5, 6, 6, 2], needed: 2, rng: seeded(s) });
    assert.ok([5, 6].includes(t.size) && t.by === 'votes');
  }
  // needed = 1: a single vote is enough.
  assert.equal(pickMode({ readyCount: 6, votes: [3], needed: 1 }).size, 3);
  // Not enough players for anything.
  assert.equal(pickMode({ readyCount: 3, votes: [2, 2] }), null);
});

test('admin-set mode wins over votes, and waits until there are enough players', () => {
  assert.deepEqual(pickMode({ readyCount: 8, votes: [2, 2, 2], fixed: 4 }), { size: 4, by: 'admin', votes: 0 });
  assert.equal(pickMode({ readyCount: 7, votes: [2, 2], fixed: 4 }), null);
});

import { projectedMode } from '../src/logic/modes.js';

test('projected next mode for the queue card', () => {
  // Nobody yet: random, aim for 4 (the smallest game).
  assert.deepEqual(projectedMode({ readyCount: 0 }), { size: null, by: 'random', fits: [], tied: [], target: 4, waitingFor: null });
  // 5 signed up, no votes: 2v2 fits, next milestone is 6 (3v3).
  assert.equal(projectedMode({ readyCount: 5 }).target, 6);
  // 2 votes for 2v2 with 5 signed up: 2v2, by votes.
  assert.deepEqual(projectedMode({ readyCount: 5, tally: { 2: 2 } }), { size: 2, by: 'votes', fits: [2], tied: [2], target: 4, waitingFor: null });
  // 3 votes for 4v4 but only 5 signed up: still random for now, waiting for 8.
  const w = projectedMode({ readyCount: 5, tally: { 4: 3 } });
  assert.equal(w.by, 'random');
  assert.equal(w.waitingFor, 4);
  assert.equal(w.target, 8);
  // A tie.
  assert.deepEqual(projectedMode({ readyCount: 8, tally: { 2: 2, 3: 2 } }).tied, [2, 3]);
  // Admin mode.
  assert.deepEqual(projectedMode({ readyCount: 3, fixed: 5, tally: { 2: 9 } }), { size: 5, by: 'admin', fits: [], tied: [], target: 10, waitingFor: null });
  // Everything fits: no further milestone.
  assert.equal(projectedMode({ readyCount: 12 }).target, null);
});
