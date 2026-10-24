import test from 'node:test';
import assert from 'node:assert/strict';
import { inkPieces, normalise, learnTemplates, classify, readCell } from '../public/js/rules/glyphs.js';

// A cell with "digits" drawn in: '1' = a bar, '0' = a ring, '7' = top bar + slanted stroke.
function cell(text, { w = 60, h = 40, ink = 240, size = 1 } = {}) {
  const data = new Uint8Array(w * h).fill(30);
  const dw = Math.round(9 * size);
  const dh = Math.round(18 * size);
  const y0 = Math.round((h - dh) / 2);
  let x0 = Math.round((w - text.length * (dw + 3)) / 2);
  const put = (x, y) => { if (x >= 0 && x < w && y >= 0 && y < h) data[y * w + x] = ink; };
  for (const ch of text) {
    for (let y = 0; y < dh; y++) {
      for (let x = 0; x < dw; x++) {
        const edge = x < 2 || x >= dw - 2 || y < 2 || y >= dh - 2;
        if (ch === '0' && edge) put(x0 + x, y0 + y);
        if (ch === '1' && x >= dw / 2 - 1 && x <= dw / 2 + 1) put(x0 + x, y0 + y);
        if (ch === '7' && (y < 3 || Math.abs(x - (dw - 1) * (1 - y / dh)) < 1.6)) put(x0 + x, y0 + y);
      }
    }
    x0 += dw + 3;
  }
  return { data, width: w, height: h };
}

const templatesFrom = (cells) => learnTemplates(cells.flatMap(([text, c]) => inkPieces(c).map((p, i) => ({ digit: text[i], glyph: normalise(c, p) }))));

test('digits are found left to right, and stray specks ignored', () => {
  const c = cell('10');
  c.data[2 * 60 + 3] = 255; // a speck in the corner
  const pieces = inkPieces(c);
  assert.equal(pieces.length, 2);
  assert.ok(pieces[0].x0 < pieces[1].x0);
});

test('reading: each digit matched with the learned ones, at any size', () => {
  const t = templatesFrom([['10', cell('10')], ['7', cell('7')], ['71', cell('71')]]);
  assert.equal(classify(normalise(cell('7', { size: 1.6, w: 90, h: 60 }), inkPieces(cell('7', { size: 1.6, w: 90, h: 60 }))[0]), t).digit, '7', 'bigger screenshot, same digit');
  const r = readCell(cell('170', { w: 80 }), t);
  assert.equal(r.value, 170);
  assert.equal(r.sure, true);
});

test('faint zeros read as 0; an empty cell is 0 but unsure', () => {
  const t = templatesFrom([['10', cell('10')], ['7', cell('7')]]);
  const faint = readCell(cell('0', { ink: 130 }), t);
  assert.deepEqual([faint.value, faint.sure], [0, true]);
  const empty = readCell(cell(''), t);
  assert.deepEqual([empty.value, empty.sure], [0, false]);
});
