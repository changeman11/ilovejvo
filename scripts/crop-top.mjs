// Crops a strip off the top of a picture in art-src/community (e.g. bits of the game's menu
// caught in a screenshot), so the cut-out script only sees the character.
//   node scripts/crop-top.mjs <file.png> <pixels>

import Jimp from 'jimp';

const [file, px] = process.argv.slice(2);
if (!file || !px) {
  console.log('Usage: node scripts/crop-top.mjs <file.png> <pixels>');
  process.exit(1);
}
const path = `art-src/community/${file}`;
const img = await Jimp.read(path);
const cut = Number(px);
img.crop(0, cut, img.bitmap.width, img.bitmap.height - cut);
await img.writeAsync(path);
console.log(`${file}: removed the top ${cut}px`);
