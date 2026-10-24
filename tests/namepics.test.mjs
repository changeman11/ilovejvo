import test from 'node:test';
import assert from 'node:assert/strict';
import { namePrint, printSimilarity, matchPrints, nameArea, printToText, printFromText } from '../public/js/rules/namepics.js';

// A name area with "letters": a pattern of bars from a seed (each name gets its own look).
// Drawn once at 120×30, then scaled (as the game draws the same name bigger on bigger screens).
function name(seed, { w = 120, h = 30, scale = 1, badge = false } = {}) {
  const base = new Uint8Array(w * h);
  let s = seed;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  // "Letters": strokes every 3 px (letter spacing, no gaps as wide as a space), each its own height.
  for (let x = 4; x < 90; x += 3) {
    const y0 = 8 + Math.floor(rnd() * 7);
    for (let y = y0; y < 22; y++) for (let dx = 0; dx < 2; dx++) base[y * w + x + dx] = 1;
  }
  if (badge) for (let x = 95; x < 115; x++) for (let y = 8; y < 22; y++) base[y * w + x] = 1;
  const W = Math.round(w * scale); const H = Math.round(h * scale);
  const ink = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) ink[y * W + x] = base[Math.floor(y / scale) * w + Math.floor(x / scale)];
  return namePrint(ink, W, H);
}

test('the same name matches itself at another screen size, with a badge after it', () => {
  const same = printSimilarity(name(7), name(7, { scale: 1.4, badge: true }));
  const other = printSimilarity(name(7), name(99));
  assert.ok(same > 0.62, `same name: ${same}`);
  assert.ok(same - other > 0.1, `clearly better than another name (${same} vs ${other})`);
});

test('the name stops before a badge and above the title pill', () => {
  // A name, a wide gap, an "mvp" badge; and a title pill touching the name from below.
  const w = 140; const h = 40;
  const ink = new Uint8Array(w * h);
  for (let x = 4; x < 50; x += 3) for (let y = 6; y < 18; y++) ink[y * w + x] = 1; // the name
  for (let x = 70; x < 95; x++) for (let y = 6; y < 18; y++) ink[y * w + x] = 1; // the badge
  for (let x = 4; x < 40; x++) for (let y = 18; y < 32; y++) ink[y * w + x] = 1; // the title pill
  const a = nameArea(ink, w, h);
  assert.equal(a.x0, 4);
  assert.ok(a.x1 < 60, `stops before the badge (${a.x1})`);
  assert.ok(a.y1 < 20, `ends above the title (${a.y1})`);
});

test('a print survives being stored as text', () => {
  const p = name(5);
  const back = printFromText(printToText(p));
  assert.equal(back.width, p.width);
  assert.deepEqual([...back.bits], [...p.bits]);
  assert.equal(printFromText('junk'), null);
});

test('lines are given the right players, each once; an unknown name gets nobody', () => {
  const known = [{ playerId: 'ari', prints: [name(1)] }, { playerId: 'ben', prints: [name(2)] }];
  const out = matchPrints([name(2, { scale: 1.3 }), name(1, { badge: true }), name(3)], known);
  assert.deepEqual(out.map((o) => o.playerId), ['ben', 'ari', null]);
});
