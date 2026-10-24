// Stats reader lab, step 2: the site's CURRENT reader (public/js/ocr.js), run in Node on every
// collected screenshot, so it can be scored. Same steps as ocr.js (headings -> layout ->
// each cell digits-only -> names), with sharp doing the canvas work.
//
//   node scripts/ocr-lab/current-reader.mjs        -> ocr-lab/current.json
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import { STAT_ORDER, layoutFromWords, cellRect, nameRect, parseCell, cleanName } from '../../public/js/rules/endscreen.js';

const LAB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'ocr-lab');
const MAX_ROWS = 6;
const lum = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;
const scaled = (rect, s) => ({ left: Math.max(0, Math.round(rect.left * s)), top: Math.max(0, Math.round(rect.top * s)), width: Math.round(rect.width * s), height: Math.round(rect.height * s) });

// A scaled black-and-white copy as PNG: pixels that pass `keep` become black on white.
export async function inkImage(raw, info, scale, keep) {
  const w = Math.round(info.width * scale);
  const h = Math.round(info.height * scale);
  const { data } = await sharp(raw, { raw: info }).resize(w, h, { kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += info.channels) out[p] = keep(data[i], data[i + 1], data[i + 2]) ? 0 : 255;
  return { png: await sharp(out, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer(), width: w, height: h };
}

export async function readCurrent(worker, file) {
  const { data: raw, info } = await sharp(readFileSync(file)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const H = 2;
  const head = await inkImage(raw, info, H, (r, g, b) => r > 200 && g > 200 && b > 200);
  await worker.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: '' });
  const { data: hd } = await worker.recognize(head.png);
  const words = hd.words.map((w) => ({ t: w.text, x: (w.bbox.x0 + w.bbox.x1) / 2 / H, y: (w.bbox.y0 + w.bbox.y1) / 2 / H }));
  const layout = layoutFromWords(words);
  if (!layout) return { error: 'no table found', size: `${info.width}x${info.height}` };
  const S = 3;
  const digits = await inkImage(raw, info, S, (r, g, b) => lum(r, g, b) > 150);
  const names = await inkImage(raw, info, S, (r, g, b) => Math.max(r, g, b) > 170);
  const panels = [];
  for (const panel of layout.panels) {
    const rows = [];
    for (let row = 0; row < MAX_ROWS; row++) {
      await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789' });
      const stats = {};
      let anyDigits = false;
      for (const stat of STAT_ORDER) {
        if (panel.cols[stat] === undefined) { stats[stat] = null; continue; }
        const rect = scaled(cellRect(layout, panel, stat, row), S);
        if (rect.top + rect.height > digits.height || rect.left + rect.width > digits.width) { stats[stat] = null; continue; }
        const { data } = await worker.recognize(digits.png, { rectangle: rect });
        if (/\d/.test(data.text)) anyDigits = true;
        stats[stat] = parseCell(data.text, data.confidence);
      }
      await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '' });
      const nRect = scaled(nameRect(layout, panel, row), S);
      const nameText = nRect.top + nRect.height <= names.height ? (await worker.recognize(names.png, { rectangle: nRect })).data.text.trim() : '';
      if (!anyDigits && !cleanName(nameText)) break;
      rows.push({ row, nameText, name: cleanName(nameText), stats });
    }
    panels.push({ rows });
  }
  return { size: `${info.width}x${info.height}`, layout, panels };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const worker = await createWorker('eng', 1);
  const out = {};
  const files = readdirSync(join(LAB, 'shots'));
  for (const [i, f] of files.entries()) {
    const t = Date.now();
    try {
      out[f] = await readCurrent(worker, join(LAB, 'shots', f));
    } catch (err) {
      out[f] = { error: err.message };
    }
    console.log(`${i + 1}/${files.length} ${f} ${out[f].error ?? `${out[f].panels.map((p) => p.rows.length).join('+')} rows`} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
    writeFileSync(join(LAB, 'current.json'), JSON.stringify(out));
  }
  await worker.terminate();
}
