// Cuts the game's volleyball out of the grey-haired character picture (circle crop), for the Home
// page characters.  art-src/community/grey-hair-ball.png -> public/images/art/ball.png
// Run from the project folder:  node scripts/cut-ball.mjs [cx cy r]
import Jimp from 'jimp';

const [cx, cy, r] = (process.argv.slice(2).length === 3 ? process.argv.slice(2) : [467, 1012, 166]).map(Number);
const src = await Jimp.read('art-src/community/grey-hair-ball.png');
// The ball touches the picture's bottom edge, so add see-through space around it first.
const PAD = 100;
const img = new Jimp(src.bitmap.width + PAD * 2, src.bitmap.height + PAD * 2, 0x00000000).composite(src, PAD, PAD);
const size = r * 2;
const ball = img.crop(cx - r + PAD, cy - r + PAD, size, size);
// Keep only the circle (the foot behind the ball and anything else outside it become see-through).
ball.scan(0, 0, size, size, function (x, y, idx) {
  const dx = x - r + 0.5;
  const dy = y - r + 0.5;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > r) this.bitmap.data[idx + 3] = 0;
  else if (dist > r - 1.5) this.bitmap.data[idx + 3] = Math.round(this.bitmap.data[idx + 3] * (r - dist) / 1.5); // smooth edge
});
// Anything left outside the ball's black outline (a sliver of the leg behind it) is cleared:
// flood in from the edge through anything that isn't the dark outline.
{
  const d = ball.bitmap.data;
  const lit = (p) => d[p * 4 + 3] > 0 && (0.3 * d[p * 4] + 0.59 * d[p * 4 + 1] + 0.11 * d[p * 4 + 2]) > 70;
  const seen = new Uint8Array(size * size);
  const stack = [];
  for (let i = 0; i < size; i++) stack.push(i, (size - 1) * size + i, i * size, i * size + size - 1);
  // Also start from every visible pixel touching the see-through area outside the circle.
  for (let p = 0; p < size * size; p++) if (d[p * 4 + 3] === 0) stack.push(p);
  while (stack.length) {
    const p = stack.pop();
    if (seen[p]) continue;
    seen[p] = 1;
    if (d[p * 4 + 3] > 0 && !lit(p)) continue; // the outline stops the fill
    d[p * 4 + 3] = 0;
    const x = p % size;
    if (x > 0) stack.push(p - 1);
    if (x < size - 1) stack.push(p + 1);
    if (p >= size) stack.push(p - size);
    if (p < size * (size - 1)) stack.push(p + size);
  }
}
ball.resize(220, 220);
await ball.writeAsync('public/images/art/ball.png');
console.log('ball.png written');
