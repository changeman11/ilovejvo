// Recognising players by the PICTURE of their in-game name on the end-of-match screen, not by
// reading it as text: a name is drawn the same way every time (same font, same letters), so its
// picture matches exactly even when a text reader would get it wrong (any language, symbols, names
// the game cuts short with "…"). Only the players in that match are compared.
// Pure functions on 0/1 ink (tests/namepics.test.mjs).
//
// A name picture ("print"): the name's ink scaled to NAME_H pixels high, its first NAME_W columns
// (the start of a name is what's always there: badges and "…" come after it).

export const NAME_H = 12;
export const NAME_W = 56;

// Name ink: names are drawn in a bright colour (green, pink, purple, gold...) or white.
export const isNameInk = (r, g, b) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return (max > 170 && max - min > 70) || min > 215;
};

// Where the NAME is in a player's name area, and nothing else. The area (w × h ink, 0/1) holds the
// name with things around it: the title pill BELOW it ("crow", "SHRIMP", "LOSER", "BOT"...), and
// badges AFTER it on the same line ("mvp", "you", "host", the crown). So:
//   - the name is the top line of ink (the first band of rows with ink at least `minH` rows tall);
//     when the title pill touches it (no clear row between), the band is split at its thinnest row
//     where a name's height would end (`maxH`), and
//   - it ends at the first gap wider than the gap between words (`wordGap` × its height): the
//     badges sit further off than that.
// Returns { x0, x1, y0, y1 } or null.
export function nameArea(ink, w, h, { minH = Math.max(3, Math.round(h * 0.12)), maxH = Math.round(h * 0.42), wordGap = 0.8 } = {}) {
  const rowInk = new Array(h).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rowInk[y] += ink[y * w + x];
  // The first band of rows with a fair amount of ink, tall enough to be letters.
  let y0 = -1; let y1 = -1;
  for (let y = 0; y < h; y++) {
    if (rowInk[y] < 2) continue;
    let e = y;
    while (e + 1 < h && rowInk[e + 1] >= 1) e++;
    if (e - y + 1 >= minH) { y0 = y; y1 = e; break; }
    y = e;
  }
  if (y0 < 0) return null;
  // Too tall to be one line of name: the title pill is touching it. Cut at the thinnest row
  // between where a short name and a tall one would end.
  if (y1 - y0 + 1 > maxH) {
    let cut = y0 + maxH; let least = Infinity;
    for (let y = y0 + Math.max(minH, Math.round(maxH * 0.55)); y <= Math.min(y1, y0 + maxH + 1); y++) {
      if (rowInk[y] < least) { least = rowInk[y]; cut = y; }
    }
    y1 = cut - 1;
  }
  const bandH = y1 - y0 + 1;
  // Columns with ink in that band; the name runs from the first until a gap wider than a space.
  const col = (x) => { for (let y = y0; y <= y1; y++) if (ink[y * w + x]) return true; return false; };
  let x0 = -1;
  for (let x = 0; x < w; x++) if (col(x)) { x0 = x; break; }
  if (x0 < 0) return null;
  let x1 = x0; let gap = 0;
  for (let x = x0; x < w; x++) {
    if (col(x)) { x1 = x; gap = 0; } else if (++gap > Math.max(2, wordGap * bandH)) break;
  }
  return { x0, x1, y0, y1 };
}

// ink: Uint8Array 0/1 for the name area (w × h). Returns a print of just the name (nameArea),
// or null when there's no name.
export function namePrint(ink, w, h) {
  const area = nameArea(ink, w, h);
  if (!area) return null;
  const top = area.y0;
  const bottom = area.y1;
  const left = area.x0;
  const right = area.x1;
  const sh = bottom - top + 1;
  const scale = NAME_H / sh;
  const bits = new Uint8Array(NAME_H * NAME_W);
  for (let gy = 0; gy < NAME_H; gy++) {
    for (let gx = 0; gx < NAME_W; gx++) {
      const x = Math.floor(left + gx / scale);
      const y = Math.floor(top + gy / scale);
      if (x <= right && y <= bottom && ink[y * w + x]) bits[gy * NAME_W + gx] = 1;
    }
  }
  // width: how many columns the name fills (a name the game cut short with "…" is narrower).
  return { bits, width: Math.min(NAME_W, Math.round((right - left + 1) * scale)) };
}

// The game cuts long names short to make room for badges ("coraxplora" -> "coraxpl…" next to
// "you"), so two pictures of one name are compared over the start they share: the narrower one's
// width, less about one letter (where its "…" may be). Shared starts shorter than MIN_SHARED
// columns (about two letters) are too little to tell names apart: they score 0.
export const MIN_SHARED = 20;

// 0..1, 1 = the same picture. Allows a pixel or two of shift (sharpness and scaling differ).
export function printSimilarity(a, b) {
  if (!a || !b) return 0;
  const cut = (p) => (p.width >= NAME_W - 1 ? NAME_W : p.width - Math.round(NAME_H * 0.9));
  const shared = Math.min(cut(a), cut(b));
  if (shared < MIN_SHARED) return 0;
  let best = 0;
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0]]) {
    let both = 0; let either = 0;
    for (let y = 0; y < NAME_H; y++) {
      for (let x = 0; x < shared; x++) {
        const p = a.bits[y * NAME_W + x];
        const xx = x + dx; const yy = y + dy;
        const q = xx >= 0 && xx < NAME_W && yy >= 0 && yy < NAME_H ? b.bits[yy * NAME_W + xx] : 0;
        if (p && q) both++;
        if (p || q) either++;
      }
    }
    if (either) best = Math.max(best, both / either);
  }
  return best;
}

// Which player each line is. lines: [print|null], known: [{ playerId, prints: [print] }] for the
// players in this match. Each player at most once, best matches first; a line is only given a
// player when its picture is clearly theirs (min) and clearly not the next player's (gap).
// Returns [{ playerId|null, score }] in line order.
export const NAME_MATCH = { min: 0.62, gap: 0.08 };
export function matchPrints(lines, known, { min = NAME_MATCH.min, gap = NAME_MATCH.gap } = {}) {
  const scores = lines.map((p) => known.map((k) => ({ playerId: k.playerId, s: Math.max(0, ...k.prints.map((q) => printSimilarity(p, q))) })).sort((a, b) => b.s - a.s));
  const pairs = [];
  scores.forEach((list, i) => {
    const [first, second] = list;
    if (first && first.s >= min && first.s - (second?.s ?? 0) >= gap) pairs.push({ i, ...first });
  });
  pairs.sort((a, b) => b.s - a.s);
  const out = lines.map(() => ({ playerId: null, score: 0 }));
  const used = new Set();
  for (const p of pairs) {
    if (out[p.i].playerId || used.has(p.playerId)) continue;
    out[p.i] = { playerId: p.playerId, score: p.s };
    used.add(p.playerId);
  }
  return out;
}
