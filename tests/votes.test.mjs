import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tallyVotes, resultFromVotes, sameSets, ownTeamLines, voteLabel } from '../public/js/rules/votes.js';
import { DEFAULT_FORMAT } from '../public/js/rules/defaults.js';

const fixture = { id: 'f1', homeTeamId: 'H', awayTeamId: 'A' };
const S21 = [{ home: 10, away: 7 }, { home: 8, away: 10 }, { home: 12, away: 10 }];
const S20 = [{ home: 10, away: 7 }, { home: 10, away: 8 }];
const sub = (id, teamId, sets, updatedAt, playerStats = {}) => ({ id, teamId, sets, updatedAt, playerStats });

test('sameSets compares every set score, numbers or text', () => {
  assert.equal(sameSets(S21, S21.map((s) => ({ home: String(s.home), away: String(s.away) }))), true);
  assert.equal(sameSets(S21, S20), false);
  assert.equal(sameSets([{ home: 10, away: 7 }], [{ home: 7, away: 10 }]), false);
});

test('no votes, one team only, agreed, disputed', () => {
  assert.equal(tallyVotes([], fixture).status, 'none');
  assert.equal(tallyVotes([sub('h1', 'H', S21, 1)], fixture).status, 'waiting');
  const agreed = tallyVotes([sub('h1', 'H', S21, 1), sub('a1', 'A', S21, 2)], fixture);
  assert.equal(agreed.status, 'agreed');
  assert.deepEqual([agreed.pair.home.id, agreed.pair.away.id], ['h1', 'a1']);
  assert.equal(tallyVotes([sub('h1', 'H', S21, 1), sub('a1', 'A', S20, 2)], fixture).status, 'disputed');
});

test('a later matching vote from a teammate resolves a dispute', () => {
  const t = tallyVotes([sub('h1', 'H', S21, 1), sub('a1', 'A', S20, 2), sub('a2', 'A', S21, 3)], fixture);
  assert.equal(t.status, 'agreed');
  assert.equal(t.pair.away.id, 'a2');
});

test('votes from teams not in the match are ignored', () => {
  assert.equal(tallyVotes([sub('x', 'Z', S21, 1), sub('h1', 'H', S21, 2)], fixture).status, 'waiting');
});

test('agreed result combines each team’s own stat lines and suggests the MVP', () => {
  const home = sub('h1', 'H', S21, 1, {
    hp1: { teamId: 'H', pts: 12 }, hp2: { teamId: 'H', pts: 5 },
    ap1: { teamId: 'A', pts: 99 }, // a home voter can't vouch for the away team
  });
  const away = sub('a1', 'A', S21, 2, { ap1: { teamId: 'A', pts: 9 } });
  const r = resultFromVotes({ home, away }, fixture, DEFAULT_FORMAT);
  assert.deepEqual(r.sets, S21);
  assert.deepEqual(Object.keys(r.playerStats).sort(), ['ap1', 'hp1', 'hp2']);
  assert.equal(r.playerStats.ap1.pts, 9);
  assert.equal(r.mvpPlayerId, 'hp1', 'top scorer on the winning (home) team');
  assert.deepEqual(r.confirmedBy, ['h1', 'a1']);
  assert.equal(r.forfeit, null);
});

test('invalid scores never become a result', () => {
  const bad = [{ home: 10, away: 9 }, { home: 10, away: 2 }]; // 10–9 isn't a finished set
  assert.equal(resultFromVotes({ home: sub('h', 'H', bad, 1), away: sub('a', 'A', bad, 2) }, fixture, DEFAULT_FORMAT), null);
});

test('helpers', () => {
  assert.deepEqual(Object.keys(ownTeamLines({ a: { teamId: 'H' }, b: { teamId: 'A' } }, 'H')), ['a']);
  assert.equal(voteLabel(S21), '2–1 (10–7, 8–10, 12–10)');
});
