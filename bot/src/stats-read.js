// Reads an end-of-match screenshot on the server (the stats reader, tested on 50 real screenshots
// in scripts/ocr-lab/, 2026-10-25):
//   - the table: Tesseract finds the column headings (PTS SPK ...), rules/endscreen.js works out
//     where every row and cell is;
//   - the numbers: each digit is compared with the game's own digits (rules/glyphs.js, templates
//     learned from real screenshots: reader/digits.json). No guessing: a digit that isn't clearly
//     one is marked unsure;
//   - the names: just the name (rules/namepics.js: no title pill, no badges), as a picture and as
//     text (Tesseract, one line).
// Matching names to players is separate (logic/reading.js), so it can be tested without pictures.
//
// reader.read(buffer) -> { size, lines: [{ side: 0|1, row, nameText, name, print, stats: { pts: { value, sure, why } } }] }
//                        or { error }
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { STAT_ORDER, layoutFromWords, cellRect, nameSearchRect, cleanName } from './site-rules/endscreen.js';
import { readCell } from './site-rules/glyphs.js';
import { isNameInk, nameArea, namePrint, printToText } from './site-rules/namepics.js';

const here = dirname(fileURLToPath(import.meta.url));
const MAX_ROWS = 6;
const IDLE_MS = 2 * 60 * 1000; // Tesseract is closed after this long unused (it holds ~150 MB)

export function loadTemplates(file = join(here, 'reader', 'digits.json')) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

// The grey picture the digits are read from: white and grey ink only (coloured names and pings count as dark).
export function greyOf(data, info) {
  const g = new Uint8Array(info.width * info.height);
  for (let p = 0, i = 0; p < g.length; p++, i += info.channels) {
    const r = data[i]; const gg = data[i + 1]; const b = data[i + 2];
    g[p] = Math.max(r, gg, b) - Math.min(r, gg, b) > 60 ? 0 : Math.round(0.3 * r + 0.59 * gg + 0.11 * b);
  }
  return { data: g, width: info.width, height: info.height };
}

export function cutCell(img, rect) {
  const left = Math.max(0, Math.round(rect.left));
  const top = Math.max(0, Math.round(rect.top));
  const width = Math.min(img.width - left, Math.round(rect.width));
  const height = Math.min(img.height - top, Math.round(rect.height));
  if (width < 4 || height < 4) return null;
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) data.set(img.data.subarray((top + y) * img.width + left, (top + y) * img.width + left + width), y * width);
  return { data, width, height };
}

// Name pictures from past matches (scripts/ocr-lab/names2.mjs), so known players are recognised
// from the start: { playerId: [print text] }.
export function loadSeedPrints(file = join(here, 'reader', 'name-prints.json')) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; }
}

export class ShotReader {
  constructor({ templates = loadTemplates(), seedPrints = loadSeedPrints(), cachePath = join(here, '..', 'data'), log = console } = {}) {
    Object.assign(this, { templates, seedPrints, cachePath, log });
    this.worker = null;
    this.idle = null;
  }

  async tesseract() {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.close(), IDLE_MS);
    this.idle.unref?.();
    if (!this.worker) {
      const { createWorker } = await import('tesseract.js');
      mkdirSync(this.cachePath, { recursive: true }); // the English data is downloaded here once
      this.worker = await createWorker('eng', 1, { cachePath: this.cachePath });
      // Screenshots have no resolution saved, so Tesseract falls back to 70 dpi, with a warning on
      // every read. Saying 70 keeps the same reading (what was tested) without the warnings.
      await this.worker.setParameters({ user_defined_dpi: '70' });
    }
    return this.worker;
  }

  async close() {
    clearTimeout(this.idle);
    const w = this.worker;
    this.worker = null;
    await w?.terminate().catch(() => {});
  }

  // maxRows: players per team in this event (a 3v3 has 3 lines per side, never more).
  async read(buffer, { maxRows = MAX_ROWS } = {}) {
    const rowsPerSide = Math.max(1, Math.min(MAX_ROWS, Number(maxRows) || MAX_ROWS));
    let raw; let info;
    try {
      ({ data: raw, info } = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true }));
    } catch {
      return { error: 'not a picture the reader can open' };
    }
    const size = `${info.width}x${info.height}`;
    const worker = await this.tesseract();

    // 1. Headings -> where the table is (white text, at 2× so small screenshots read too).
    const H = 2;
    const w2 = info.width * H; const h2 = info.height * H;
    const { data: big } = await sharp(raw, { raw: info }).resize(w2, h2, { kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
    const head = Buffer.alloc(w2 * h2);
    for (let p = 0, i = 0; p < head.length; p++, i += info.channels) head[p] = big[i] > 200 && big[i + 1] > 200 && big[i + 2] > 200 ? 0 : 255;
    await worker.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: '' });
    const { data: hd } = await worker.recognize(await sharp(head, { raw: { width: w2, height: h2, channels: 1 } }).png().toBuffer());
    const layout = layoutFromWords(hd.words.map((w) => ({ t: w.text, x: (w.bbox.x0 + w.bbox.x1) / 2 / H, y: (w.bbox.y0 + w.bbox.y1) / 2 / H })));
    if (!layout) return { error: 'no stats table found (is it the end-of-match screen?)', size };

    // 2. Every row's numbers and name.
    const grey = greyOf(raw, info);
    await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '' });
    const lines = [];
    for (const [side, panel] of layout.panels.entries()) {
      for (let row = 0; row < rowsPerSide; row++) {
        const stats = {};
        let cells = 0; let empty = 0;
        for (const stat of STAT_ORDER) {
          if (panel.cols[stat] === undefined) continue;
          const cell = cutCell(grey, cellRect(layout, panel, stat, row));
          if (!cell) continue;
          stats[stat] = readCell(cell, this.templates);
          cells++;
          if (stats[stat].why === 'nothing there') empty++;
        }
        // An empty slot (fewer players than rows) has nothing in most of its cells; real lines
        // show faint zeros.
        if (!cells || empty > cells / 2) continue;
        const name = await this.readName(worker, raw, info, nameSearchRect(layout, panel, row));
        lines.push({ side, row, ...name, stats });
      }
    }
    return { size, lines };
  }

  // One line's name: its picture (as text, to store) and its text, read from just the name.
  async readName(worker, img, info, rect) {
    const sl = Math.max(0, Math.round(rect.left)); const st = Math.max(0, Math.round(rect.top));
    const sw = Math.min(info.width - sl, Math.round(rect.width)); const sh = Math.min(info.height - st, Math.round(rect.height));
    if (sw < 4 || sh < 4) return { nameText: '', name: '', print: null };
    const ink = new Uint8Array(sw * sh);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { const i = ((st + y) * info.width + sl + x) * info.channels; ink[y * sw + x] = isNameInk(img[i], img[i + 1], img[i + 2]) ? 1 : 0; }
    const a = nameArea(ink, sw, sh);
    if (!a) return { nameText: '', name: '', print: null };
    const pad = 2;
    const x0 = Math.max(0, a.x0 - pad); const y0 = Math.max(0, a.y0 - pad);
    const w = Math.min(sw - x0, a.x1 - a.x0 + 1 + 2 * pad); const h = Math.min(sh - y0, a.y1 - a.y0 + 1 + 2 * pad);
    const out = Buffer.alloc(w * h, 255);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ink[(y0 + y) * sw + x0 + x]) out[y * w + x] = 0;
    const png = await sharp(out, { raw: { width: w, height: h, channels: 1 } }).resize({ height: h * 3, kernel: 'nearest' })
      .extend({ top: 12, bottom: 12, left: 12, right: 12, background: { r: 255, g: 255, b: 255 } }).png().toBuffer();
    const { data } = await worker.recognize(png);
    const nameText = data.text.trim();
    const print = namePrint(ink, sw, sh);
    return { nameText, name: cleanName(nameText) || nameText, print: print ? printToText(print) : null };
  }
}
