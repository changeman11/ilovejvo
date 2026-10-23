// Shrinks an animated GIF in the browser before it's uploaded, keeping it animated.
// The picture is resized to the size it's shown at; if it's still too big, it's made smaller
// again and/or every other frame is dropped (the timing is kept, so it plays at the same speed).
// This keeps stored files small (2 / 4 / 6 MB limits), so profiles stay cheap to serve.
//
// Libraries (loaded only when someone picks a GIF): gifuct-js reads GIFs, gifenc writes them.

const READ = 'https://cdn.jsdelivr.net/npm/gifuct-js@2.1.2/+esm';
const WRITE = 'https://cdn.jsdelivr.net/npm/gifenc@1.0.3/+esm';
const MAX_FRAMES = 240; // longer GIFs keep every other (or every third...) frame

// The GIF's frames as full pictures: [{ image: ImageData, delay (ms) }], plus its size.
function fullFrames(parsed, decompressFrames) {
  const frames = decompressFrames(parsed, true);
  const w = parsed.lsd.width;
  const h = parsed.lsd.height;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const patchCanvas = new OffscreenCanvas(1, 1);
  const patchCtx = patchCanvas.getContext('2d');
  const out = [];
  let previous = null;
  for (const f of frames) {
    // Undo the previous frame as the GIF asks ("disposal").
    if (previous?.disposalType === 2) ctx.clearRect(previous.dims.left, previous.dims.top, previous.dims.width, previous.dims.height);
    const before = f.disposalType === 3 ? ctx.getImageData(0, 0, w, h) : null;
    patchCanvas.width = f.dims.width;
    patchCanvas.height = f.dims.height;
    patchCtx.putImageData(new ImageData(f.patch, f.dims.width, f.dims.height), 0, 0);
    ctx.drawImage(patchCanvas, f.dims.left, f.dims.top);
    out.push({ image: ctx.getImageData(0, 0, w, h), delay: Math.max(20, f.delay || 100) });
    if (before) ctx.putImageData(before, 0, 0);
    previous = f;
  }
  return { frames: out, width: w, height: h };
}

function encode({ frames, width, height }, scale, step, GIF) {
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const src = new OffscreenCanvas(width, height);
  const srcCtx = src.getContext('2d');
  const dst = new OffscreenCanvas(w, h);
  const dstCtx = dst.getContext('2d', { willReadFrequently: true });
  const enc = GIF.GIFEncoder();
  for (let i = 0; i < frames.length; i += step) {
    // Keep the timing: a kept frame lasts as long as the frames it replaces.
    let delay = 0;
    for (let j = i; j < Math.min(i + step, frames.length); j++) delay += frames[j].delay;
    srcCtx.putImageData(frames[i].image, 0, 0);
    dstCtx.clearRect(0, 0, w, h);
    dstCtx.drawImage(src, 0, 0, w, h);
    const { data } = dstCtx.getImageData(0, 0, w, h);
    const palette = GIF.quantize(data, 256, { format: 'rgba4444', oneBitAlpha: true });
    const index = GIF.applyPalette(data, palette, 'rgba4444');
    const transparentIndex = palette.findIndex((c) => c[3] === 0);
    enc.writeFrame(index, w, h, {
      palette,
      delay,
      repeat: 0, // loop forever
      ...(transparentIndex >= 0 ? { transparent: true, transparentIndex } : {}),
    });
  }
  enc.finish();
  return new Blob([enc.bytes()], { type: 'image/gif' });
}

// file: the GIF picked. maxSide: longest side in pixels. maxBytes: the size it must end up under.
// Returns a Blob, or throws if it can't get small enough.
export async function shrinkGif(file, { maxSide, maxBytes }) {
  const [read, GIF] = await Promise.all([import(READ), import(WRITE)]);
  const parsed = read.parseGIF(await file.arrayBuffer());
  const all = fullFrames(parsed, read.decompressFrames);
  if (!all.frames.length) throw new Error('No frames');
  const fit = Math.min(1, maxSide / Math.max(all.width, all.height));
  const baseStep = Math.max(1, Math.ceil(all.frames.length / MAX_FRAMES));
  // Try the full size first, then smaller and/or fewer frames until it fits.
  const tries = [[1, 1], [0.8, 1], [0.8, 2], [0.6, 2], [0.5, 3], [0.4, 4]];
  for (const [s, st] of tries) {
    const blob = encode(all, fit * s, baseStep * st, GIF);
    if (blob.size <= maxBytes) return blob;
  }
  throw new Error('Still too big');
}
