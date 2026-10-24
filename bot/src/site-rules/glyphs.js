// Exact number reading for just volleyball's end-of-match screen. The numbers are always drawn in
// the game's one font (bold white with a dark outline; zeros faint grey), so instead of a general
// text reader each digit is compared with pictures of the game's own digits ("templates", learned
// from real screenshots). Pure functions on grey pixels (0-255), no image library: tested in
// tests/glyphs.test.mjs, used by the bot and the lab scripts (scripts/ocr-lab/).
//
// cell = { data: Uint8Array grey values, width, height } (one stat cell, original pixels)

export const GLYPH_W = 14;
export const GLYPH_H = 20;

// Pieces of bright ink in a cell: digits are bright (fill ~230+), faint zeros grey (~110-170).
// Returns [{ x0, y0, x1, y1, area, bright }] left to right, only pieces shaped like a digit:
// tall enough (a share of the cell's height), not touching the top or bottom edge, near the middle.
export function inkPieces(cell, { level = 150 } = {}) {
  const { data, width: w, height: h } = cell;
  const seen = new Uint8Array(w * h);
  const pieces = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || data[start] < level) continue;
    let x0 = w; let y0 = h; let x1 = -1; let y1 = -1; let area = 0; let sum = 0; let peak = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop();
      const x = p % w;
      const y = (p / w) | 0;
      area++; sum += data[p];
      if (data[p] > peak) peak = data[p];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && !seen[q] && data[q] >= level) { seen[q] = 1; stack.push(q); }
      }
    }
    pieces.push({ x0, y0, x1, y1, area, bright: sum / area, peak });
  }
  const tall = (p) => p.y1 - p.y0 + 1;
  // Digits are about half the cell's height; stray bits (sparkles, outlines of things behind) aren't.
  return pieces
    .filter((p) => tall(p) >= 0.32 * h && tall(p) <= 0.95 * h && (p.x1 - p.x0 + 1) <= 0.9 * tall(p) + 2 && p.area >= 0.15 * tall(p) * tall(p) * 0.3)
    .filter((p) => (p.y0 + p.y1) / 2 > 0.2 * h && (p.y0 + p.y1) / 2 < 0.8 * h)
    .sort((a, b) => a.x0 - b.x0);
}

// One digit piece, scaled to GLYPH_W × GLYPH_H, as 0..1 ink values (keeps its aspect: centred).
export function normalise(cell, piece, level = 150) {
  const { data, width: w } = cell;
  const pw = piece.x1 - piece.x0 + 1;
  const ph = piece.y1 - piece.y0 + 1;
  const scale = GLYPH_H / ph;
  const offX = (GLYPH_W - pw * scale) / 2;
  const out = new Float32Array(GLYPH_W * GLYPH_H);
  for (let gy = 0; gy < GLYPH_H; gy++) {
    for (let gx = 0; gx < GLYPH_W; gx++) {
      // Sample the source area this output pixel covers.
      const sx0 = (gx - offX) / scale;
      const sy0 = gy / scale;
      let ink = 0;
      let n = 0;
      for (let sy = sy0; sy < sy0 + 1 / scale; sy += Math.max(0.5, 0.5 / scale)) {
        for (let sx = sx0; sx < sx0 + 1 / scale; sx += Math.max(0.5, 0.5 / scale)) {
          const x = Math.floor(piece.x0 + sx);
          const y = Math.floor(piece.y0 + sy);
          n++;
          if (x < piece.x0 || x > piece.x1 || y < piece.y0 || y > piece.y1) continue;
          if (data[y * w + x] >= level) ink++;
        }
      }
      out[gy * GLYPH_W + gx] = n ? ink / n : 0;
    }
  }
  return out;
}

// How different two normalised glyphs are (0 = the same, 1 = opposite).
export function glyphDiff(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

const average = (list) => {
  const avg = new Float32Array(list[0].length);
  for (const g of list) for (let i = 0; i < g.length; i++) avg[i] += g[i] / list.length;
  return avg;
};

// Labels can be wrong (stats confirmed without checking repeated the old reader's mistakes, e.g. a
// 6 saved as 0). Wrongly-labelled examples are a minority, so: average each digit, drop examples
// that look more like ANOTHER digit's average, and repeat. Returns { digit: [glyphs] } kept.
export function trustedSamples(samples, rounds = 3) {
  let by = {};
  for (const s of samples) (by[s.digit] ??= []).push(s.glyph);
  for (let r = 0; r < rounds; r++) {
    const means = Object.fromEntries(Object.entries(by).filter(([, l]) => l.length).map(([d, l]) => [d, average(l)]));
    const next = {};
    for (const [d, list] of Object.entries(by)) {
      next[d] = list.filter((g) => {
        let best = d; let bestD = Infinity;
        for (const [e, m] of Object.entries(means)) { const x = glyphDiff(g, m); if (x < bestD) { bestD = x; best = e; } }
        return best === d;
      });
    }
    by = next;
  }
  return by;
}

// Learns templates: samples = [{ digit: '0'-'9', glyph: Float32Array }] -> { digit: [glyphs] }
// (several per digit, so small differences in size and sharpness are covered). Only examples
// that look like the rest of their digit are used (trustedSamples).
export function learnTemplates(samples, { perDigit = 12 } = {}) {
  const by = trustedSamples(samples);
  const out = {};
  for (const [d, list] of Object.entries(by)) {
    if (!list.length) continue;
    // Keep a spread: the average first, then the samples least like those already kept.
    const avg = new Float32Array(list[0].length);
    for (const g of list) for (let i = 0; i < g.length; i++) avg[i] += g[i] / list.length;
    const kept = [avg];
    while (kept.length < Math.min(perDigit, list.length + 1)) {
      let best = null; let bestD = -1;
      for (const g of list) {
        const d2 = Math.min(...kept.map((k) => glyphDiff(g, k)));
        if (d2 > bestD) { bestD = d2; best = g; }
      }
      if (!best || bestD < 0.02) break;
      kept.push(best);
    }
    out[d] = kept;
  }
  return out;
}

// Which digit a glyph is: { digit, diff, margin } (margin = how much worse the next-best digit is).
export function classify(glyph, templates) {
  const scores = Object.entries(templates).map(([d, list]) => [d, Math.min(...list.map((t) => glyphDiff(glyph, t)))]).sort((a, b) => a[1] - b[1]);
  return { digit: scores[0]?.[0] ?? null, diff: scores[0]?.[1] ?? 1, margin: (scores[1]?.[1] ?? 1) - (scores[0]?.[1] ?? 1) };
}

// Limits for "sure": the best digit must look like its template and clearly beat the next one.
export const SURE = { maxDiff: 0.16, minMargin: 0.05 };

// Ink levels, measured on 50 real screenshots (scripts/ocr-lab/brightness.mjs, 2026-10-25): digits
// are pure white (brightest ink 252-255 in every one); the faint zeros are grey (98-109). Light bits
// of the background behind the table (sky, grass) reach ~230, so they never count as digits.
// A digit's SHAPE is taken at INK (so small, blurry screenshots keep whole digits); whether it's a
// real white digit is decided by its brightest point (BRIGHT).
export const INK = 150;
export const BRIGHT = 235;
export const FAINT = 85;

// The white digits in a cell (shape at INK, brightest point at least BRIGHT).
export const brightPieces = (cell) => inkPieces(cell, { level: INK }).filter((p) => p.peak >= BRIGHT);

// Reads one stat cell: bright digits first; if there are none, a faint zero.
// Returns { value, sure, why } (why: what made it unsure, in words).
export function readCell(cell, templates) {
  let pieces = brightPieces(cell);
  let faint = false;
  if (!pieces.length) {
    pieces = inkPieces(cell, { level: FAINT }).filter((p) => p.peak < BRIGHT);
    faint = true;
  }
  if (!pieces.length) return { value: 0, sure: false, why: 'nothing there' };
  if (pieces.length > 3) return { value: null, sure: false, why: `${pieces.length} marks in the cell` };
  const level = faint ? FAINT : INK;
  const reads = pieces.map((p) => classify(normalise(cell, p, level), templates));
  const digits = reads.map((r) => r.digit).join('');
  const value = Number(digits);
  const shaky = reads.find((r) => r.diff > SURE.maxDiff || r.margin < SURE.minMargin);
  if (faint && value !== 0) return { value, sure: false, why: 'faint number that isn’t a zero' };
  return { value, sure: !shaky, why: shaky ? `unclear digit (looks ${(100 * (1 - shaky.diff)).toFixed(0)}% like ${shaky.digit})` : null };
}
