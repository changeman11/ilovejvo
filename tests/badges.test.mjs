import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playerBadges, playerXp, levelFor, teamCareer, teamBadges } from '../public/js/rules/badges.js';

const m = (home, away, homeSets, awaySets, homePoints = 20, awayPoints = 10) => ({
  homeTeamId: home, awayTeamId: away, homeSets, awaySets, homePoints, awayPoints, winner: homeSets > awaySets ? 'home' : 'away',
});

test('no matches, no badges', () => {
  assert.deepEqual(playerBadges(null), []);
  assert.deepEqual(playerBadges({ matches: 0, wins: 0, mvps: 0, totals: {}, log: [] }), []);
  assert.deepEqual(teamBadges(undefined), []);
});

test('player badges take the highest step reached, best first', () => {
  const log = [
    ...Array.from({ length: 6 }, () => ({ eventId: 'e1', won: true, setsAgainst: 0 })),
    ...Array.from({ length: 6 }, () => ({ eventId: 'e2', won: false, setsAgainst: 2 })),
  ];
  const career = { matches: 12, wins: 6, mvps: 1, totals: { pts: 120, ace: 3 }, log };
  const badges = playerBadges(career, [{ key: 'pts', name: 'Points' }, { key: 'ace', name: 'Aces' }]);
  const byId = Object.fromEntries(badges.map((b) => [b.id, b]));
  assert.equal(byId.matches.title, '10 matches');
  assert.equal(byId.matches.tier, 2);
  assert.equal(byId.wins.title, '5 wins');
  assert.equal(byId.mvps.title, 'MVP');
  assert.equal(byId.sweeps.title, '5 clean sweeps');
  assert.equal(byId['stat-pts'].title, '100 points');
  assert.equal(byId['stat-ace'], undefined, 'below the first milestone');
  assert.equal(byId.events, undefined, 'two events is below the first step (3)');
  for (let i = 1; i < badges.length; i++) assert.ok(badges[i - 1].tier >= badges[i].tier);
});

test('levels: level n needs 25 × n² XP', () => {
  assert.deepEqual(levelFor(0), { level: 0, xp: 0, next: 25, from: 0 });
  assert.equal(levelFor(24).level, 0);
  assert.equal(levelFor(25).level, 1);
  assert.equal(levelFor(100).level, 2);
  assert.equal(levelFor(224).level, 2);
  assert.equal(playerXp({ matches: 2, wins: 1, mvps: 1, log: [{ won: true, setsAgainst: 0 }, { won: false, setsAgainst: 2 }] }), 20 + 15 + 25 + 5);
});

test('team career: records, streaks, sweeps, unbeaten events, form', () => {
  const career = teamCareer([
    { eventId: 'e1', matches: [m('A', 'B', 2, 0), m('B', 'A', 1, 2), m('A', 'C', 2, 1)] },
    { eventId: 'e2', matches: [m('C', 'A', 2, 0, 20, 5), m('A', 'B', 2, 0)] },
  ]);
  const a = career.get('A');
  assert.equal(a.matches, 5);
  assert.equal(a.wins, 4);
  assert.equal(a.losses, 1);
  assert.equal(a.setsWon, 8);
  assert.equal(a.setsLost, 4);
  assert.equal(a.sweeps, 2);
  assert.equal(a.bestStreak, 3);
  assert.equal(a.streak, 1);
  assert.equal(a.events, 2);
  assert.equal(a.unbeatenEvents, 1, 'won all 3 in e1');
  assert.deepEqual(a.form, ['W', 'W', 'W', 'L', 'W']);
  assert.equal(a.pointsLost, 10 + 20 + 10 + 20 + 10);
  const badges = Object.fromEntries(teamBadges(a).map((b) => [b.id, b.title]));
  assert.equal(badges.streak, '3-win streak');
  assert.equal(badges.unbeaten, 'Unbeaten event');
  assert.equal(career.get('B').wins, 0);
});
