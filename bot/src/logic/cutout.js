// Cuts a community character out of its plain background (same method as the site's
// scripts/cut-characters.mjs), and says whether a picture is suitable at all. Pure: works on raw
// RGBA pixels, so it's tested without any image library (characters.js does the decoding).
//
// Suitable = one character on a plain, not-dark background:
//   - not wide (screenshots and player cards are landscape)
//   - the four corners agree on one background colour (not a court or a scene)
//   - the background isn't near-black (the characters' black outlines would be cut away too)
//   - the character is a sensible share of the picture after cutting
//
// cutout({ data, width, height }) -> { ok: true, box: { x, y, w, h }, mask } | { ok: false, reason }
//   data: RGBA bytes. mask[p] = 1 where the pixel becomes see-through.

const dist = (d, i, c) => Math.abs(d[i] - c[0]) + Math.abs(d[i + 1] - c[1]) + Math.abs(d[i + 2] - c[2]);

export const CUTOUT_LIMITS = { maxAspect: 1.15, darkBg: 45, minShare: 6, maxShare: 75, cornerAgree: 30, tol: 60 };

export function cutout({ data: d, width: w, height: h }, limits = CUTOUT_LIMITS) {
  if (w / h > limits.maxAspect) return { ok: false, reason: 'wide picture (a screenshot or a card?)' };
  const at = (x, y) => (y * w + x) * 4;
  const corners = [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]].map(([x, y]) => at(x, y));
  const mask = new Uint8Array(w * h);

  // Already see-through around the edges: keep its own transparency.
  if (corners.every((i) => d[i + 3] < 10)) {
    for (let p = 0; p < w * h; p++) if (d[p * 4 + 3] < 10) mask[p] = 1;
    return finish(mask, w, h, limits);
  }

  const colours = corners.map((i) => [d[i], d[i + 1], d[i + 2]]);
  const agree = (c) => colours.filter((o) => dist(o, 0, c) < limits.cornerAgree).length;
  const bg = [...colours].sort((a, b) => agree(b) - agree(a))[0];
  if (agree(bg) < 3) return { ok: false, reason: 'busy background (not one plain colour)' };
  if ((bg[0] + bg[1] + bg[2]) / 3 < limits.darkBg) return { ok: false, reason: 'dark background (the black outlines would be lost)' };

  // Flood fill from every edge pixel through background-coloured pixels.
  const stack = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const p = stack.pop();
    if (mask[p] || dist(d, p * 4, bg) > limits.tol) continue;
    mask[p] = 1;
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
  // Enclosed pockets of exactly the background colour (e.g. between the legs).
  for (let p = 0; p < w * h; p++) if (!mask[p] && dist(d, p * 4, bg) <= 18) mask[p] = 1;
  return finish(mask, w, h, limits);
}

function finish(mask, w, h, limits) {
  let minX = w; let minY = h; let maxX = -1; let maxY = -1; let kept = 0;
  for (let p = 0; p < w * h; p++) {
    if (mask[p]) continue;
    kept++;
    const x = p % w;
    const y = (p / w) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const share = (kept / (w * h)) * 100;
  if (share < limits.minShare || share > limits.maxShare) return { ok: false, reason: `couldn't find one character (${Math.round(share)}% kept)` };
  return { ok: true, mask, box: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }, share: Math.round(share) };
}

// Fingerprints (the cut-out on white, shrunk to 12×16 RGB): the average difference per value.
// Re-posts of a character already on the site score about 1-6; different characters 16 or more
// (checked on the 47 pictures in #in-game-characters, 2026-10-25).
export const REPEAT_LIMIT = 10;
export function printDiff(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}
