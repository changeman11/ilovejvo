// Stats reader lab: the size and shape of every collected screenshot.
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'ocr-lab', 'shots');
const count = {};
for (const f of readdirSync(SHOTS)) {
  const m = await sharp(readFileSync(join(SHOTS, f))).metadata(); // (sharp can't open very long Windows paths itself)
  const key = `${m.width}x${m.height} ${m.format} (${(m.width / m.height).toFixed(2)})`;
  (count[key] ??= []).push(f);
}
for (const [k, v] of Object.entries(count).sort((a, b) => b[1].length - a[1].length)) console.log(`${v.length}× ${k}  e.g. ${v[0]}`);
