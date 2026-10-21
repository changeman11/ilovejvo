// Profile images: team logos, player pictures, banners and page backgrounds (GIFs allowed).
// Files live in Firebase Storage; the database only keeps each file's path (e.g. "teams/x/logo/abc.gif").
// The Storage library is loaded only when someone actually uploads or removes a file.

import { app, adminApp } from './firebase.js';
import { firebaseConfig, useEmulators, emulatorPorts } from './config.js';

const MB = 1024 * 1024;

// An error whose message is safe and useful to show to the person.
export class FriendlyError extends Error {}

// What each kind of image is for, its size limit (matches storage.rules) and how big
// still pictures are resized to. GIFs are uploaded as they are, so they keep moving.
export const MEDIA = {
  logo: { label: 'Logo', maxMb: 2, maxSide: 512, hint: 'Square works best.' },
  avatar: { label: 'Profile picture', maxMb: 2, maxSide: 512, hint: 'Square works best. Leave empty to use your Discord picture.' },
  banner: { label: 'Banner', maxMb: 4, maxSide: 1600, hint: 'Wide, about 4 : 1 (e.g. 1600 × 400).' },
  background: { label: 'Page background', maxMb: 6, maxSide: 1920, hint: 'Fills the page behind your profile.' },
};

// Public address of a stored file (or null).
export function mediaUrl(path) {
  if (!path) return null;
  const host = useEmulators ? `http://${location.hostname}:${emulatorPorts.storage}` : 'https://firebasestorage.googleapis.com';
  return `${host}/v0/b/${firebaseConfig.storageBucket}/o/${encodeURIComponent(path)}?alt=media`;
}

let sdk = null;
const storages = {};
async function storageFor(admin) {
  sdk ??= await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js');
  const key = admin ? 'admin' : 'player';
  if (!storages[key]) {
    const s = sdk.getStorage(admin ? adminApp : app);
    if (useEmulators) sdk.connectStorageEmulator(s, location.hostname, emulatorPorts.storage);
    storages[key] = s;
  }
  return storages[key];
}

// Checks a chosen file and gets it ready: GIFs as they are; still pictures shrunk and saved as WebP.
export async function prepareImage(file, kind) {
  const spec = MEDIA[kind];
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new FriendlyError(`${spec.label}: use a PNG, JPG, WebP or GIF image.`);
  if (file.type === 'image/gif') {
    if (file.size > spec.maxMb * MB) throw new FriendlyError(`${spec.label}: GIFs can be up to ${spec.maxMb} MB. Try a shorter or smaller GIF.`);
    return { blob: file, ext: 'gif', type: 'image/gif' };
  }
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new FriendlyError(`${spec.label}: that image couldn’t be read. Try another file.`);
  }
  const scale = Math.min(1, spec.maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.88));
  if (!blob) throw new FriendlyError(`${spec.label}: that image couldn’t be read. Try another file.`);
  const ext = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/jpeg' ? 'jpg' : 'png';
  if (blob.size > spec.maxMb * MB) throw new FriendlyError(`${spec.label}: still too big after shrinking. Try a smaller image.`);
  return { blob, ext, type: blob.type || 'image/png' };
}

// Uploads a prepared image. owner: 'teams' | 'players'. Returns the new file's path.
export async function uploadImage({ owner, id, kind, image, admin = false }) {
  const storage = await storageFor(admin);
  const name = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const path = `${owner}/${id}/${kind}/${name}.${image.ext}`;
  try {
    await sdk.uploadBytes(sdk.ref(storage, path), image.blob, {
      contentType: image.type,
      cacheControl: 'public, max-age=31536000, immutable', // each upload has its own name
    });
  } catch (err) {
    console.error(err);
    if (err.code === 'storage/unauthorized') throw new FriendlyError(`${MEDIA[kind].label}: you can’t upload that here (too big, or not your profile).`);
    throw new FriendlyError(`${MEDIA[kind].label}: upload failed. Check your connection and try again.`);
  }
  return path;
}

// Removes a stored file. Missing files are fine (already gone).
export async function deleteImage(path, { admin = false } = {}) {
  if (!path) return;
  try {
    const storage = await storageFor(admin);
    await sdk.deleteObject(sdk.ref(storage, path));
  } catch (err) {
    if (err?.code !== 'storage/object-not-found') console.warn('Couldn’t remove old image', path, err);
  }
}
