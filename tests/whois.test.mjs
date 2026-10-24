import test from 'node:test';
import assert from 'node:assert/strict';
import { whoIsWho } from '../public/js/rules/whois.js';

const teams = { red: ['ari', 'ben'], blue: ['cat', 'dan'] };
const known = {
  ari: { names: ['Ariana'], prints: [] },
  ben: { names: ['Benny Boy'], prints: [] },
  cat: { names: ['Catalyst'], prints: [] },
  dan: { names: ['Danger'], prints: [] },
};

test('names are matched within their own side, whichever way round the teams are', () => {
  const lines = [
    { side: 0, text: 'Catalyst', print: null },
    { side: 0, text: 'Danger', print: null },
    { side: 1, text: 'Ariana', print: null },
    { side: 1, text: 'Benny Boy', print: null },
  ];
  assert.deepEqual(whoIsWho(lines, teams, known).map((o) => o.playerId), ['cat', 'dan', 'ari', 'ben']);
});

test('the last line on a side gets the last player; an unclear name with two left gets nobody', () => {
  const lines = [
    { side: 0, text: 'Ariana', print: null },
    { side: 0, text: 'xX_q_Xx', print: null },
    { side: 1, text: '???', print: null },
    { side: 1, text: 'zzz', print: null },
  ];
  const out = whoIsWho(lines, teams, known);
  assert.equal(out[0].playerId, 'ari');
  assert.equal(out[1].playerId, 'ben');
  assert.equal(out[1].why, 'the only one left');
  assert.equal(out[2].playerId, null);
  assert.equal(out[3].playerId, null);
});
