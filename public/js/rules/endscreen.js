// Reading just volleyball's end-of-match screen. Pure helpers (no OCR library, no browser), so
// they're tested: where the columns and rows are, turning what the text reader saw into numbers,
// and matching in-game names to site players. The OCR itself is in public/js/ocr.js.
//
// The screen has two tables (home on the left, away on the right). Each has the headings
//   player  pts spk blk rec set ast ace dig
// and one row per player. The layout scales with the screen, so everything is measured from the
// headings: `colGap` is the distance between the "pts" and "spk" headings.

export const STAT_ORDER = ['pts', 'spk', 'blk', 'rec', 'set', 'ast', 'ace', 'dig'];

// Measured on a real screenshot (1843 × 1035): first row centre is 2.05 column gaps below the
// headings, rows are 1.295 column gaps apart.
const FIRST_ROW = 2.05;
const ROW_GAP = 1.295;

// words: [{ t: text, x, y }] centres of words found in the headings pass (original image pixels).
// Returns { panels: [{ playerX, headerY, cols: { pts: x, ... } }], colGap } or null if not found.
export function layoutFromWords(words) {
  const heads = words.filter((w) => w.t?.toLowerCase() === 'player').sort((a, b) => a.x - b.x);
  if (!heads.length) return null;
  const panels = heads.map((p, i) => {
    const right = heads[i + 1]?.x ?? Infinity;
    const cols = {};
    for (const stat of STAT_ORDER) {
      const w = words
        .filter((v) => v.t?.toLowerCase() === stat && v.x > p.x && v.x < right && Math.abs(v.y - p.y) < 40)
        .sort((a, b) => a.x - b.x)[0];
      if (w) cols[stat] = w.x;
    }
    return { playerX: p.x, headerY: p.y, cols };
  }).filter((p) => p.cols.pts !== undefined && p.cols.spk !== undefined);
  if (!panels.length) return null;
  const colGap = panels[0].cols.spk - panels[0].cols.pts;
  if (!(colGap > 10)) return null;
  // A heading the reader missed, between two it found, can be filled in from the spacing.
  for (const p of panels) {
    STAT_ORDER.forEach((stat, i) => {
      if (p.cols[stat] === undefined && i > 0 && p.cols[STAT_ORDER[i - 1]] !== undefined && p.cols[STAT_ORDER[i + 1]] !== undefined) {
        p.cols[stat] = (p.cols[STAT_ORDER[i - 1]] + p.cols[STAT_ORDER[i + 1]]) / 2;
      }
    });
  }
  return { panels, colGap };
}

export const rowCentre = (layout, panel, row) => panel.headerY + (FIRST_ROW + row * ROW_GAP) * layout.colGap;

// Rectangles (original image pixels) to read: one per stat cell, and the name.
export function cellRect(layout, panel, stat, row) {
  const g = layout.colGap;
  const cy = rowCentre(layout, panel, row);
  return { left: panel.cols[stat] - 0.45 * g, top: cy - 0.32 * g, width: 0.9 * g, height: 0.64 * g };
}
export function nameRect(layout, panel, row) {
  const g = layout.colGap;
  const cy = rowCentre(layout, panel, row);
  const left = panel.playerX + 0.45 * g;
  return { left, top: cy - 0.42 * g, width: Math.max(g, panel.cols.pts - 0.6 * g - left), height: 0.4 * g };
}

// What the reader saw in a stat cell -> a number. Blank = 0 (the game draws zeros faintly).
// Returns { value, sure } where sure=false means "check this one".
export function parseCell(text, confidence = 100) {
  const digits = String(text ?? '').replace(/\D/g, '');
  if (!digits) return { value: 0, sure: false };
  const value = Number(digits);
  return { value, sure: confidence >= 60 && digits.length <= 3 };
}

// Badges and tags the game shows next to names; never part of a name.
const BADGES = new Set(['mvp', 'you', 'bot', 'loser', 'crow', 'easy', 'twin', 'host', 'ee', 'see', 'mm']);

// "zapdrEs mm" -> "zapdrEs", "Aero , EE SEE" -> "Aero"
export function cleanName(text) {
  const tokens = String(text ?? '')
    .split(/[\s,.;:|]+/)
    .map((t) => t.replace(/[^\p{L}\p{N}_-]/gu, ''))
    .filter((t) => t.length >= 2 && !BADGES.has(t.toLowerCase()));
  return tokens[0] ?? '';
}

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

// 0..1, 1 = identical (Levenshtein distance scaled by length).
export function similarity(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (x[i - 1] === y[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return 1 - prev[y.length] / Math.max(x.length, y.length);
}

// Matches read names to players. names: ['BB', 'spec', ...]
// candidates: [{ id, names: ['displayName', ...gameNames] }]
// Returns [{ name, playerId|null, score }] in the same order; each player is used at most once.
export function matchNames(names, candidates, { min = 0.6 } = {}) {
  const pairs = [];
  names.forEach((name, i) => {
    for (const c of candidates) {
      const score = Math.max(...c.names.filter(Boolean).map((n) => similarity(name, n)), 0);
      if (score >= min) pairs.push({ i, id: c.id, score });
    }
  });
  pairs.sort((a, b) => b.score - a.score);
  const out = names.map((name) => ({ name, playerId: null, score: 0 }));
  const used = new Set();
  for (const p of pairs) {
    if (out[p.i].playerId || used.has(p.id)) continue;
    out[p.i].playerId = p.id;
    out[p.i].score = p.score;
    used.add(p.id);
  }
  return out;
}
