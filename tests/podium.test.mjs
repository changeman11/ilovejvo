import { test } from 'node:test';
import assert from 'node:assert/strict';
import { podium, latestPodium, trophiesByTeam } from '../public/js/rules/podium.js';
import { DEFAULT_FORMAT } from '../public/js/rules/defaults.js';

const season = { format: DEFAULT_FORMAT, standings: { matchPoints: { '2-0': 3, '2-1': 2, '1-2': 1, '0-2': 0 }, tiebreakers: ['points'] } };
const win = { sets: [{ home: 10, away: 5 }, { home: 10, away: 6 }] };
const lose = { sets: [{ home: 5, away: 10 }, { home: 6, away: 10 }] };
const ko = (id, home, away) => ({ id, homeTeamId: home, awayTeamId: away, stage: 'playoffs' });
const bundle = (fixtures, results, extra = {}) => ({ event: { id: 'e', title: 'Cup', date: 1, finals: { type: 'semis' }, ...extra }, season, teams: [], fixtures, results });

test('podium: final winner 1st, loser 2nd; 3rd from the 3rd place match', () => {
  const b = bundle([ko('finals-sf1', 'a', 'd'), ko('finals-sf2', 'b', 'c'), ko('finals-3rd', 'd', 'c'), ko('finals-final', 'a', 'b')],
    { 'finals-sf1': win, 'finals-sf2': win, 'finals-3rd': lose, 'finals-final': lose });
  assert.deepEqual(podium(b).places, [{ place: 1, teamIds: ['b'] }, { place: 2, teamIds: ['a'] }, { place: 3, teamIds: ['c'] }]);
});

test('podium: without a 3rd place match the semi-final losers share 3rd; nothing until the final is played', () => {
  const fixtures = [ko('finals-sf1', 'a', 'd'), ko('finals-sf2', 'b', 'c'), ko('finals-final', 'a', 'b')];
  assert.equal(podium(bundle(fixtures, { 'finals-sf1': win, 'finals-sf2': win })), null);
  const p = podium(bundle(fixtures, { 'finals-sf1': win, 'finals-sf2': lose, 'finals-final': win }));
  assert.deepEqual(p.places[2], { place: 3, teamIds: ['d', 'b'] });
});

test('podium: no knockout = the table once every match is played', () => {
  const f = (id, h, a) => ({ id, homeTeamId: h, awayTeamId: a });
  const fixtures = [f('1', 'a', 'b'), f('2', 'b', 'c'), f('3', 'a', 'c')];
  const teams = ['a', 'b', 'c'].map((id) => ({ id, name: id }));
  const none = { finals: { type: 'none' } };
  assert.equal(podium({ ...bundle(fixtures, { 1: win, 2: win }, none), teams }), null, 'not finished');
  const p = podium({ ...bundle(fixtures, { 1: win, 2: win, 3: win }, none), teams });
  assert.deepEqual(p.places.map((x) => x.teamIds[0]), ['a', 'b', 'c']);
});

test('latest podium and each team\'s trophies', () => {
  const old = bundle([ko('finals-final', 'a', 'b')], { 'finals-final': win }, { id: 'old', title: 'Old Cup', date: 1, finals: { type: 'final' } });
  const recent = bundle([ko('finals-final', 'c', 'a')], { 'finals-final': win }, { id: 'new', title: 'New Cup', date: 5, finals: { type: 'final' } });
  const unfinished = bundle([ko('finals-final', 'a', 'c')], {}, { id: 'next', date: 9, finals: { type: 'final' } });
  assert.equal(latestPodium([old, recent, unfinished]).b.event.id, 'new');
  const t = trophiesByTeam([old, recent]);
  assert.deepEqual(t.get('a').map((x) => [x.place, x.title]), [[1, 'Old Cup'], [2, 'New Cup']]);
  assert.deepEqual(t.get('c').map((x) => x.place), [1]);
});
