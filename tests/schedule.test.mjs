import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundRobin, missingGames } from '../public/js/rules/schedule.js';

test('top-up: only matchups without a fixture are added, either way round', () => {
  const games = roundRobin(['a', 'b', 'c', 'd']); // 6 pairings
  const existing = [{ homeTeamId: 'b', awayTeamId: 'a' }, { homeTeamId: 'c', awayTeamId: 'd' }, { homeTeamId: null, awayTeamId: 'a' }];
  const missing = missingGames(games, existing);
  assert.equal(missing.length, 4);
  assert.ok(!missing.some((g) => [g.homeTeamId, g.awayTeamId].sort().join() === 'a,b'));
  // Home & away: one existing a–b game still leaves the return leg
  const twice = missingGames(roundRobin(['a', 'b'], { double: true }), [{ homeTeamId: 'a', awayTeamId: 'b' }]);
  assert.equal(twice.length, 1);
  assert.equal(missingGames(games, games).length, 0);
});

function pairKey(f) {
  return [f.homeTeamId, f.awayTeamId].sort().join('-');
}

test('single round robin: everyone meets once, nobody plays twice in a round', () => {
  const teams = ['a', 'b', 'c', 'd', 'e', 'f'];
  const fx = roundRobin(teams);
  assert.equal(fx.length, 15);
  assert.equal(new Set(fx.map(pairKey)).size, 15);
  for (let r = 1; r <= 5; r++) {
    const playing = fx.filter((f) => f.round === r).flatMap((f) => [f.homeTeamId, f.awayTeamId]);
    assert.equal(new Set(playing).size, 6);
  }
});

test('double round robin swaps home and away', () => {
  const fx = roundRobin(['a', 'b', 'c', 'd'], { double: true });
  assert.equal(fx.length, 12);
  const homeAway = new Set(fx.map((f) => `${f.homeTeamId}-${f.awayTeamId}`));
  assert.equal(homeAway.size, 12);
  assert.equal(Math.max(...fx.map((f) => f.round)), 6);
});

test('odd team count gives one bye per round', () => {
  const fx = roundRobin(['a', 'b', 'c', 'd', 'e']);
  assert.equal(fx.length, 10);
  for (let r = 1; r <= 5; r++) {
    assert.equal(fx.filter((f) => f.round === r).length, 2);
  }
});

test('home games are spread fairly', () => {
  const fx = roundRobin(['a', 'b', 'c', 'd', 'e', 'f'], { double: true });
  const homes = {};
  for (const f of fx) homes[f.homeTeamId] = (homes[f.homeTeamId] ?? 0) + 1;
  for (const count of Object.values(homes)) assert.equal(count, 5);
});

test('home and away are balanced: every team within one of an even split, no long away runs', async () => {
  const { roundRobin } = await import('../public/js/rules/schedule.js');
  for (const n of [3, 4, 5, 6, 7, 8, 10, 12]) {
    const teams = Array.from({ length: n }, (_, i) => `t${i}`);
    const games = roundRobin(teams);
    for (const t of teams) {
      const mine = games.filter((g) => g.homeTeamId === t || g.awayTeamId === t).sort((x, y) => x.round - y.round);
      const home = mine.filter((g) => g.homeTeamId === t).length;
      const away = mine.length - home;
      assert.ok(Math.abs(home - away) <= 1, `${n} teams: ${t} has ${home} home, ${away} away`);
      let run = 0;
      let worst = 0;
      let prev = null;
      for (const g of mine) {
        const side = g.homeTeamId === t ? 'h' : 'a';
        run = side === prev ? run + 1 : 1;
        prev = side;
        worst = Math.max(worst, run);
      }
      assert.ok(worst <= 3, `${n} teams: ${t} has ${worst} in a row on one side`);
    }
  }
});
