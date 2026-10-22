import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutFromWords, cellRect, nameRect, rowCentre, parseCell, cleanName, similarity, matchNames } from '../public/js/rules/endscreen.js';

// Headings exactly as the text reader found them on a real end-of-match screenshot (1843 × 1035).
const WORDS = [
  { t: 'defeat', x: 921, y: 92 },
  { t: 'player', x: 90, y: 199 }, { t: 'pts', x: 350, y: 200 }, { t: 'spk', x: 416, y: 199 }, { t: 'blk', x: 483, y: 197 },
  { t: 'rec', x: 550, y: 199 }, { t: 'set', x: 617, y: 197 }, { t: 'ast', x: 683, y: 197 }, { t: 'ace', x: 749, y: 199 },
  { t: 'dig', x: 814, y: 198 }, { t: 'net', x: 963, y: 197 },
  { t: 'player', x: 1084, y: 199 }, { t: 'pts', x: 1424, y: 200 }, { t: 'spk', x: 1490, y: 199 }, { t: 'blk', x: 1556, y: 197 },
  { t: 'rec', x: 1624, y: 199 }, { t: 'set', x: 1690, y: 197 }, { t: 'ast', x: 1757, y: 197 },
  { t: '11', x: 351, y: 335 }, { t: 'set', x: 600, y: 900 }, // stray words elsewhere are ignored
];

test('finds both tables and their columns from the headings', () => {
  const l = layoutFromWords(WORDS);
  assert.equal(l.panels.length, 2);
  assert.equal(l.colGap, 66);
  assert.deepEqual(Object.keys(l.panels[0].cols), ['pts', 'spk', 'blk', 'rec', 'set', 'ast', 'ace', 'dig']);
  assert.equal(l.panels[1].cols.ace, undefined, 'the away table is cut off at ace/dig on this screen');
  assert.equal(l.panels[0].cols.set, 617);
});

test('row and cell positions land on the real numbers', () => {
  const l = layoutFromWords(WORDS);
  const p = l.panels[0];
  // Real row centres were ~335, ~420, ~506
  assert.ok(Math.abs(rowCentre(l, p, 0) - 335) < 6);
  assert.ok(Math.abs(rowCentre(l, p, 1) - 420) < 6);
  assert.ok(Math.abs(rowCentre(l, p, 2) - 506) < 6);
  const r = cellRect(l, p, 'pts', 0);
  assert.ok(r.left < 350 && r.left + r.width > 350 && r.top < 335 && r.top + r.height > 335);
  const n = nameRect(l, p, 0);
  assert.ok(n.left < 125 && n.left + n.width < 350, 'name box stops before the numbers');
});

test('missing headings: none found, or one filled in from the spacing', () => {
  assert.equal(layoutFromWords([{ t: 'defeat', x: 1, y: 1 }]), null);
  const gap = WORDS.filter((w) => !(w.t === 'blk' && w.x < 1000));
  assert.equal(layoutFromWords(gap).panels[0].cols.blk, (416 + 550) / 2);
});

test('cells: numbers, blanks (faint zeros) and junk', () => {
  assert.deepEqual(parseCell('21', 96), { value: 21, sure: true });
  assert.deepEqual(parseCell('', 0), { value: 0, sure: false });
  assert.deepEqual(parseCell(' 7\n', 91), { value: 7, sure: true });
  assert.equal(parseCell('13', 30).sure, false);
});

test('names: badges and reading noise are dropped', () => {
  assert.equal(cleanName('zapdrEs mm'), 'zapdrEs');
  assert.equal(cleanName('Aero , EE SEE'), 'Aero');
  assert.equal(cleanName('BB'), 'BB');
  assert.equal(cleanName('All... s oree'), 'All');
  assert.equal(cleanName(''), '');
});

test('names are matched to players, allowing for small reading mistakes and old names', () => {
  assert.equal(similarity('zapdrEs', 'zapdres'), 1);
  assert.ok(similarity('Volkaineo', 'Volkaine0') > 0.8);
  const candidates = [
    { id: 'p-zap', names: ['zapdrEs'] },
    { id: 'p-spec', names: ['spectre', 'spec'] }, // "spec" is a saved in-game name
    { id: 'p-volk', names: ['Volkaineo'] },
    { id: 'p-aero', names: ['Aero'] },
  ];
  const m = matchNames(['BB', 'spec', 'zapdrEs', 'Aero', 'All', 'Volkaine0'], candidates);
  assert.deepEqual(m.map((x) => x.playerId), [null, 'p-spec', 'p-zap', 'p-aero', null, 'p-volk']);
});

test('each player is matched once, to the closest name', () => {
  const m = matchNames(['Aero', 'Aer0x'], [{ id: 'a', names: ['Aero'] }]);
  assert.deepEqual(m.map((x) => x.playerId), ['a', null]);
});
