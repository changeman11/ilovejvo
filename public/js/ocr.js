// Reads stats off a just volleyball end-of-match screenshot, in the browser (free: tesseract.js).
// The text reader (~5 MB) only downloads when someone presses "Read stats".
//
// 1. Find the column headings (player, pts, spk, ...) to work out where everything is.
// 2. Read every stat cell on its own (digits only) from a black-and-white copy of the picture.
// 3. Read each player's name (names are white, green or pink).
// Layout maths and name matching live in rules/endscreen.js (tested).

import { STAT_ORDER, layoutFromWords, cellRect, nameRect, parseCell, cleanName } from './rules/endscreen.js';

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js';
const WORKER = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js';
const MAX_ROWS = 6;

// A scaled black-and-white copy: pixels that pass `keep` become black text on white.
function inkCanvas(bitmap, scale, keep) {
  const c = document.createElement('canvas');
  c.width = Math.round(bitmap.width * scale);
  c.height = Math.round(bitmap.height * scale);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(bitmap, 0, 0, c.width, c.height);
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = keep(d[i], d[i + 1], d[i + 2]) ? 0 : 255;
    d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

// Opens any picture the browser can show (PNG, JPG, WebP, GIF, BMP, AVIF, phone photos...).
// If it can't be opened directly, the browser draws it once and it's turned into a PNG first.
async function toBitmap(blob) {
  try {
    return await createImageBitmap(blob);
  } catch { /* try the PNG route */ }
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Couldn’t open that picture. Save it as a PNG or JPG and try again.'));
      i.src = url;
    });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    const png = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('Couldn’t open that picture. Save it as a PNG or JPG and try again.');
    return await createImageBitmap(png);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const lum = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;
const scaled = (rect, s) => ({ left: Math.max(0, Math.round(rect.left * s)), top: Math.max(0, Math.round(rect.top * s)), width: Math.round(rect.width * s), height: Math.round(rect.height * s) });

// image: a URL or Blob. onProgress(text) for a status line.
// Returns { panels: [{ rows: [{ nameText, name, stats: { pts: { value, sure } | null, ... } }] }] }
// A stat is null when its column isn't on the screenshot (e.g. cut off at the edge).
export async function readEndScreen(image, { onProgress = () => {} } = {}) {
  onProgress('Loading the screenshot…');
  const blob = image instanceof Blob ? image : await (await fetch(image)).blob();
  const bitmap = await toBitmap(blob);

  onProgress('Loading the text reader (first time takes a few seconds)…');
  const mod = await import(TESSERACT);
  const createWorker = mod.createWorker ?? mod.default?.createWorker;
  const worker = await createWorker('eng', 1, { workerPath: WORKER });
  try {
    // 1. Headings: bright white text, anywhere on the screen.
    onProgress('Finding the stats table…');
    const H = 2;
    const headCanvas = inkCanvas(bitmap, H, (r, g, b) => r > 200 && g > 200 && b > 200);
    await worker.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: '' });
    const { data: head } = await worker.recognize(headCanvas);
    const words = head.words.map((w) => ({ t: w.text, x: (w.bbox.x0 + w.bbox.x1) / 2 / H, y: (w.bbox.y0 + w.bbox.y1) / 2 / H }));
    const layout = layoutFromWords(words);
    if (!layout) throw new Error('Couldn’t find the stats table. Use a full, uncropped screenshot of the end-of-match screen.');

    // 2. Numbers (white; faint zeros are grey) and 3. names (white / green / pink).
    const S = 3;
    const digits = inkCanvas(bitmap, S, (r, g, b) => lum(r, g, b) > 150);
    const names = inkCanvas(bitmap, S, (r, g, b) => Math.max(r, g, b) > 170);
    const panels = [];
    for (const [pi, panel] of layout.panels.entries()) {
      const rows = [];
      for (let row = 0; row < MAX_ROWS; row++) {
        onProgress(`Reading ${pi === 0 ? 'left' : 'right'} table, row ${row + 1}…`);
        await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789' });
        const stats = {};
        let anyDigits = false;
        for (const stat of STAT_ORDER) {
          if (panel.cols[stat] === undefined) { stats[stat] = null; continue; }
          const rect = scaled(cellRect(layout, panel, stat, row), S);
          if (rect.top + rect.height > digits.height) { stats[stat] = null; continue; }
          const { data } = await worker.recognize(digits, { rectangle: rect });
          if (/\d/.test(data.text)) anyDigits = true;
          stats[stat] = parseCell(data.text, data.confidence);
        }
        await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '' });
        const nRect = scaled(nameRect(layout, panel, row), S);
        const nameText = nRect.top + nRect.height <= names.height ? (await worker.recognize(names, { rectangle: nRect })).data.text.trim() : '';
        // Past the last player there are no numbers and no name.
        if (!anyDigits && !cleanName(nameText)) break;
        rows.push({ nameText, name: cleanName(nameText), stats });
      }
      panels.push({ rows });
    }
    onProgress('');
    return { panels };
  } finally {
    await worker.terminate();
  }
}
