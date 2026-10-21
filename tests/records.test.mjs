import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statAwards, seasonHonours, allTimeRecords, milestonesReached, recordWatch } from '../public/js/rules/records.js';
import { seasonPlayerStats } from '../public/js/rules/stats.js';
import { DEFAULT_FORMAT } from '../public/js/rules/defaults.js';

const STATS = [{ key: 'pts', label: 'PTS', name: 'Points' }, { key: 'ace', label: 'ACE', name: 'Aces' }];
const teams = [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }];

// Season helper: list of [home, away, sets, playerStats, mvp]
function bundle(id, status, games) {
  const fixtures = [];
  const results = {};
  games.forEach(([home, away, sets, playerStats, mvp], i) => {
    const fid = `${id}-m${i}`;
    fixtures.push({ id: fid, homeTeamId: home, awayTeamId: away, round: i + 1, scheduledAt: i + 1 });
    if (sets) results[fid] = { sets, playerStats, mvpPlayerId: mvp };
  });
  return {
    season: { id, name: id, status, format: DEFAULT_FORMAT, stats: STATS, divisions: [{ teamIds: ['A', 'B'] }] },
    teams, fixtures, results,
  };
}
const AW = [{ home: 10, away: 2 }, { home: 10, away: 3 }]; // A (home) wins big: 20-5
const BW = [{ home: 16, away: 14 }, { home: 5, away: 10 }, { home: 8, away: 10 }]; // away wins 2-1, 30-point set

const s1 = bundle('s1', 'finished', [
  ['A', 'B', AW, { ana: { teamId: 'A', pts: 12, ace: 1 }, bo: { teamId: 'B', pts: 3 } }, 'ana'],
  ['A', 'B', BW, { ana: { teamId: 'A', pts: 9 }, bo: { teamId: 'B', pts: 14, ace: 4 } }, 'bo'],
]);
const s2 = bundle('s2', 'live', [
  ['B', 'A', [{ home: 3, away: 10 }, { home: 4, away: 10 }], { ana: { teamId: 'A', pts: 40, ace: 2 }, bo: { teamId: 'B', pts: 5 } }, 'ana'],
  ['B', 'A', null],
]);

test('live awards: #1 holds the prize, ties are joint', () => {
  const players = seasonPlayerStats({ matches: [], results: {}, statKeys: ['pts'] });
  assert.deepEqual(statAwards(players, STATS)[0].holders, []);

  const fake = new Map([
    ['x', { playerId: 'x', matches: 2, mvps: 1, totals: { pts: 10, ace: 3 }, log: [{ teamId: 'A' }] }],
    ['y', { playerId: 'y', matches: 2, mvps: 1, totals: { pts: 8, ace: 3 }, log: [{ teamId: 'B' }] }],
  ]);
  const [pts, ace, mvp] = statAwards(fake, STATS);
  assert.equal(pts.prize, 'Top Scorer');
  assert.deepEqual(pts.holders.map((h) => h.playerId), ['x']);
  assert.deepEqual(ace.holders.map((h) => h.playerId), ['x', 'y']);
  assert.equal(mvp.key, 'mvps');
  assert.equal(mvp.holders.length, 2);
});

test('season honours: premiers settled only when the regular season is done', () => {
  const h1 = seasonHonours(s1);
  assert.equal(h1.premiersId, 'A'); // A: 1 win (3 pts) + 1-2 loss (1 pt) vs B: 2 pts
  assert.equal(h1.premiersSettled, true);
  assert.equal(h1.championId, null); // no playoffs in this bundle
  const h2 = seasonHonours(s2);
  assert.equal(h2.premiersSettled, false);
  assert.equal(h2.finished, false);
});

test('all-time records: match, season, career and team', () => {
  const r = allTimeRecords([s1, s2], STATS);
  assert.deepEqual([r.match.pts.value, r.match.pts.playerId, r.match.pts.seasonId], [40, 'ana', 's2']);
  assert.deepEqual([r.match.ace.value, r.match.ace.playerId], [4, 'bo']);
  assert.deepEqual([r.season.pts.value, r.season.pts.seasonId], [40, 's2']);
  assert.equal(r.career.pts.value, 61);
  assert.equal(r.career.matches.value, 3);
  assert.equal(r.team.biggestWin.margin, 15); // 20-5
  assert.equal(r.team.biggestWin.winnerId, 'A');
  assert.equal(r.team.highestSet.total, 30); // 16-14
  assert.equal(r.team.longestStreak.length, 1); // A won, lost, won
  assert.equal(r.team.mostTablePoints.teamId, 'A');
});

test('streaks run across seasons and records keep the first holder on ties', () => {
  const t1 = bundle('t1', 'finished', [['A', 'B', AW, { ana: { teamId: 'A', pts: 10 } }], ['A', 'B', AW, { ana: { teamId: 'A', pts: 3 } }]]);
  const t2 = bundle('t2', 'live', [['A', 'B', AW, { cy: { teamId: 'A', pts: 10 } }]]);
  const r = allTimeRecords([t1, t2], STATS);
  assert.equal(r.team.longestStreak.length, 3);
  assert.deepEqual(r.team.longestStreak.from, { seasonId: 't1', fixtureId: 't1-m0' });
  assert.equal(r.match.pts.playerId, 'ana');
});

test('milestones are recorded in the match they were reached', () => {
  const ladders = { default: [20, 50], matches: [2] };
  const { events, running } = milestonesReached([s1, s2], STATS, ladders);
  const anaPts = events.filter((e) => e.playerId === 'ana' && e.key === 'pts').map((e) => [e.threshold, e.fixtureId]);
  assert.deepEqual(anaPts.sort(), [[20, 's1-m1'], [50, 's2-m0']]);
  assert.ok(events.some((e) => e.playerId === 'bo' && e.key === 'matches' && e.threshold === 2));
  assert.equal(running.get('ana').pts, 61);
});

test('record watch finds players close to a milestone or record', () => {
  const running = new Map([['ana', { pts: 95, matches: 3 }], ['bo', { pts: 40, matches: 3 }]]);
  const items = recordWatch(running, { pts: { value: 100, playerId: 'zed' } }, [{ key: 'pts' }], { ladders: { default: [100], matches: [10] } });
  assert.ok(items.some((i) => i.type === 'milestone' && i.playerId === 'ana' && i.need === 5));
  assert.ok(items.some((i) => i.type === 'record' && i.playerId === 'ana' && i.need === 6));
  assert.ok(!items.some((i) => i.playerId === 'bo'));
});
