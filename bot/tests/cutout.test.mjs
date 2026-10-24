import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutout } from '../src/logic/cutout.js';

// A picture: background colour everywhere, with a black-outlined coloured "character" box.
function picture({ w = 100, h = 140, bg = [58, 58, 64], body = [230, 80, 60], box = [30, 20, 70, 120] } = {}) {
  const data = new Uint8Array(w * h * 4);
  const [x0, y0, x1, y1] = box;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inside = x >= x0 && x < x1 && y >= y0 && y < y1;
      const edge = inside && (x < x0 + 2 || x >= x1 - 2 || y < y0 + 2 || y >= y1 - 2);
      const c = edge ? [0, 0, 0] : inside ? body : bg;
      data.set([...c, 255], i);
    }
  }
  return { data, width: w, height: h };
}

test('cut-out: a character on a plain grey background is cut and trimmed to its box', () => {
  const r = cutout(picture());
  assert.equal(r.ok, true);
  assert.deepEqual(r.box, { x: 30, y: 20, w: 40, h: 100 });
  assert.equal(r.mask[0], 1, 'background is see-through');
  assert.equal(r.mask[(50 * 100) + 50], 0, 'the character stays');
});

test('cut-out: white backgrounds work too', () => {
  assert.equal(cutout(picture({ bg: [242, 244, 251] })).ok, true);
});

test('cut-out refuses screenshots, cards, scenes, black backgrounds and empty pictures', () => {
  assert.match(cutout(picture({ w: 190, h: 120, box: [80, 10, 110, 110] })).reason, /wide/);
  assert.match(cutout(picture({ bg: [12, 12, 14] })).reason, /dark/);
  const scene = picture();
  // Different corners: a court, not a plain background.
  scene.data.set([40, 160, 60, 255], 0); scene.data.set([40, 160, 60, 255], (2 * 100 + 2) * 4);
  scene.data.set([120, 190, 240, 255], (2 * 100 + 97) * 4);
  assert.match(cutout(scene).reason, /busy/);
  assert.match(cutout(picture({ box: [49, 69, 51, 71] })).reason, /one character/);
});
