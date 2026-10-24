// Cuts community characters out of their plain backgrounds for the Home page.
//   art-src/community/*.png|jpg|webp  ->  public/images/characters/<name>.png  (+ list.json)
// (art-src/community/skipped/ is ignored: pictures that aren't a character on a plain background.)
// Run from the project folder:  node scripts/cut-characters.mjs
//
// The background colour is taken from the picture's corners. Everything of that colour that
// touches the edge is removed (a "flood fill"), plus any leftover pockets of exactly that colour
// (e.g. between the legs). The characters have thick black outlines, so the fill stops at them.
// The picture is then trimmed to the character and resized.

import Jimp from 'jimp';
import sharp from 'sharp'; // only to read .webp (Jimp can't)
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename, extname } from 'node:path';

const SRC = 'art-src/community';
const OUT = 'public/images/characters';
const HEIGHT = 640; // final height in pixels
mkdirSync(OUT, { recursive: true });

const dist = (d, i, c) => Math.abs(d[i] - c[0]) + Math.abs(d[i + 1] - c[1]) + Math.abs(d[i + 2] - c[2]);

async function cut(file) {
  const img = /\.webp$/i.test(file) ? await Jimp.read(await sharp(join(SRC, file)).png().toBuffer()) : await Jimp.read(join(SRC, file));
  const { width: w, height: h, data: d } = img.bitmap;
  // Already transparent (corners see-through)? Then just trim and resize.
  const cornerAlpha = [0, w - 1, (h - 1) * w, h * w - 1].map((p) => d[p * 4 + 3]);
  if (cornerAlpha.every((a) => a < 10)) return trimAndSave(img, file, 'transparent', (p) => d[p * 4 + 3] < 10);
  // Background colour: the most common of the four corners (a watermark can sit in one).
  const corners = [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]].map(([x, y]) => {
    const i = (y * w + x) * 4;
    return [d[i], d[i + 1], d[i + 2]];
  });
  const bg = corners.sort((a, b) => corners.filter((c) => dist(c, 0, b) < 20).length - corners.filter((c) => dist(c, 0, a) < 20).length)[0];

  // Flood fill from every edge pixel through background-coloured pixels.
  const TOL = 60;
  const clear = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const p = stack.pop();
    if (clear[p]) continue;
    if (dist(d, p * 4, bg) > TOL) continue;
    clear[p] = 1;
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
  // Enclosed pockets of exactly the background colour.
  for (let p = 0; p < w * h; p++) if (!clear[p] && dist(d, p * 4, bg) <= 18) clear[p] = 1;
  return trimAndSave(img, file, `rgb(${bg.join(',')})`, (p) => clear[p] === 1);
}

// Makes the cleared pixels see-through, trims to the character and resizes.
async function trimAndSave(img, file, bgLabel, isClear) {
  const { width: w, height: h, data: d } = img.bitmap;
  let minX = w; let minY = h; let maxX = 0; let maxY = 0;
  let cleared = 0;
  for (let p = 0; p < w * h; p++) {
    if (isClear(p)) { d[p * 4 + 3] = 0; cleared++; continue; }
    const x = p % w;
    const y = (p / w) | 0;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  img.crop(minX, minY, maxX - minX + 1, maxY - minY + 1).resize(Jimp.AUTO, HEIGHT);
  const name = basename(file, extname(file)).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  await img.writeAsync(join(OUT, `${name}.png`));
  return { name, bg: bgLabel, keptShare: Math.round((1 - cleared / (w * h)) * 100) };
}

const files = readdirSync(SRC).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort();
const done = [];
for (const f of files) {
  const r = await cut(f);
  done.push(r);
  console.log(`${f.padEnd(26)} -> ${r.name}.png  (background ${r.bg}, character is ${r.keptShare}% of the picture)`);
}
writeFileSync(join(OUT, 'list.json'), JSON.stringify(done.map((r) => `${r.name}.png`), null, 1));
console.log(`\n${done.length} characters -> ${OUT}/list.json`);
