// The game's match-details pop-up (from the menu), as players often screenshot it instead of the
// end-of-match screen (added 2026-11-21). One column: an optional heading row (grey "player pts
// spk ..."), a green "home" bar, that team's rows, a pink "away" bar, that team's rows. Screenshots
// of it are often cropped, so this works without any heading words:
//   - the bars (wide green / pink strips) say which team a row belongs to;
//   - the rows are the bands of white / grey number ink between and below them;
//   - the columns are the 8 rightmost columns of number ink, always in the game's order
//     (pts spk blk rec set ast ace dig).
// Pure: works on raw RGB pixels. -> { rows: [{ side, cy }], cols: [x * 8], gap, rowGap, barLeft } or null.

const isGreenBar = (r, g, b) => g > 200 && r < 150 && b > 80 && b < 200;
const isPinkBar = (r, g, b) => r > 200 && g < 120 && b > 120;
// Number ink: white digits and the grey zeros; not coloured (names, avatars, badges).
const isNumberInk = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b) < 40 && (r + g + b) / 3 > 70;

// Runs of true values in a list: [{ from, to }] (inclusive), joining gaps up to `join`.
function runs(list, join = 0) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    if (!list[i]) continue;
    const last = out[out.length - 1];
    if (last && i - last.to <= join + 1) last.to = i;
    else out.push({ from: i, to: i });
  }
  return out;
}

export function popupLayout(raw, info) {
  const { width: W, height: H, channels: C } = info;
  const px = (x, y) => { const i = (y * W + x) * C; return [raw[i], raw[i + 1], raw[i + 2]]; };

  // 1. The bars: rows of pixels mostly green or mostly pink.
  const rowKind = new Array(H).fill(null);
  const barLefts = [];
  for (let y = 0; y < H; y++) {
    let g = 0; let p = 0; let first = -1;
    for (let x = 0; x < W; x += 2) {
      const [r, gg, b] = px(x, y);
      if (isGreenBar(r, gg, b)) { g++; if (first < 0) first = x; } else if (isPinkBar(r, gg, b)) { p++; if (first < 0) first = x; }
    }
    if (g > W * 0.25) { rowKind[y] = 'home'; barLefts.push(first); } else if (p > W * 0.25) { rowKind[y] = 'away'; barLefts.push(first); }
  }
  const bars = [];
  for (let y = 0; y < H; y++) {
    if (!rowKind[y]) continue;
    const last = bars[bars.length - 1];
    if (last && last.kind === rowKind[y] && y - last.bottom <= 3) last.bottom = y;
    else bars.push({ kind: rowKind[y], top: y, bottom: y });
  }
  const realBars = bars.filter((b) => b.bottom - b.top >= 8);
  if (!realBars.length) return null;
  const barLeft = barLefts.length ? barLefts.sort((a, b) => a - b)[Math.floor(barLefts.length / 2)] : 0;

  // 2. Number ink, outside the bars, right of 35% of the width (avatars and names are left of it).
  const x0 = Math.floor(W * 0.35);
  const inBar = (y) => realBars.some((b) => y >= b.top - 2 && y <= b.bottom + 2);
  const rowInk = new Array(H).fill(0);
  for (let y = 0; y < H; y++) {
    if (inBar(y)) continue;
    for (let x = x0; x < W; x++) {
      const [r, g, b] = px(x, y);
      if (isNumberInk(r, g, b)) rowInk[y]++;
    }
  }

  // 3. Row bands: the heights with number ink.
  const bands = runs(rowInk.map((n) => n >= 4), 3).filter((b) => b.to - b.from >= 8);
  if (!bands.length) return null;
  // Side of each band: under a home bar -> home; under an away bar -> away; above the first bar:
  // the other team when that bar is "away" (the home rows above it were cropped from the top),
  // otherwise it's the heading row (skipped).
  const rows = [];
  for (const band of bands) {
    const cy = (band.from + band.to) / 2;
    const above = realBars.filter((b) => b.bottom < band.from).pop();
    let side;
    if (above) side = above.kind === 'home' ? 0 : 1;
    else if (realBars[0].kind === 'away') side = 0;
    else continue; // headings
    rows.push({ side, cy, h: band.to - band.from });
  }
  if (!rows.length) return null;

  // 4. Columns: clusters of number ink in the player rows only (not the score banner or headings);
  // the rightmost 8 are pts .. dig.
  const colInk = new Array(W).fill(0);
  for (const band of bands) {
    if (!rows.some((r) => r.cy === (band.from + band.to) / 2)) continue;
    for (let y = band.from; y <= band.to; y++) for (let x = x0; x < W; x++) { const [r, g, b] = px(x, y); if (isNumberInk(r, g, b)) colInk[x]++; }
  }
  const clusters = runs(colInk.map((n) => n >= 3), Math.round(W * 0.008)).filter((c) => c.to - c.from >= 3);
  if (clusters.length < 8) return null;
  const cols = clusters.slice(-8).map((c) => (c.from + c.to) / 2);
  const gaps = cols.slice(1).map((x, i) => x - cols[i]);
  const gap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  // Evenly spaced, or it isn't the stats table.
  if (gaps.some((g) => Math.abs(g - gap) > gap * 0.3)) return null;

  // Row spacing (for the name area): the usual distance between rows of one team.
  const steps = [];
  for (let i = 1; i < rows.length; i++) if (rows[i].side === rows[i - 1].side) steps.push(rows[i].cy - rows[i - 1].cy);
  const rowGap = steps.length ? steps.sort((a, b) => a - b)[Math.floor(steps.length / 2)] : gap * 1.15;
  return { rows: rows.map(({ side, cy }) => ({ side, cy })), cols, gap, rowGap, barLeft };
}

// Where a cell / a name is, in original pixels.
export const popupCellRect = (lay, col, cy) => ({ left: lay.cols[col] - 0.45 * lay.gap, top: cy - 0.24 * lay.rowGap, width: 0.9 * lay.gap, height: 0.48 * lay.rowGap });
export function popupNameRect(lay, cy) {
  const left = lay.barLeft + 0.95 * lay.rowGap;
  const right = lay.cols[0] - 1.6 * lay.gap;
  return { left, top: cy - 0.38 * lay.rowGap, width: Math.max(lay.gap, right - left), height: 0.41 * lay.rowGap };
}
