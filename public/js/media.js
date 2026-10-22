// Profile images: team logos, player pictures, banners and page backgrounds (GIFs allowed).
// Files are stored in Firebase Storage (storage.rules); the database only keeps each file's path,
// e.g. "teams/x/logo/abc.gif". The Storage library loads only when someone uploads or removes a file.
//
// Before 2026-10-22 images were kept by our Cloudflare Worker (worker/src/media.js) under the same
// paths. If a picture isn't in Firebase yet, the page quietly loads it from the Worker instead
// (see the "error" listener below), until an admin copies it across (copyOldImage).

import { app, adminApp, usingDiscordAdmin } from './firebase.js';
import { authWorkerUrl, firebaseConfig, useEmulators, emulatorPorts } from './config.js';

const MB = 1024 * 1024;

// An error whose message is safe and useful to show to the person.
export class FriendlyError extends Error {}

// What each kind of image is for, its size limit (the Worker checks the same) and how big
// still pictures are resized to. GIFs are uploaded as they are, so they keep moving.
export const MEDIA = {
  logo: { label: 'Logo', maxMb: 2, maxSide: 512, hint: 'Square works best.' },
  avatar: { label: 'Profile picture', maxMb: 2, maxSide: 512, hint: 'Square works best. Leave empty to use your Discord picture.' },
  banner: { label: 'Banner', maxMb: 4, maxSide: 1600, hint: 'Wide, about 4 : 1 (e.g. 1600 × 400).' },
  background: { label: 'Page background', maxMb: 6, maxSide: 1920, hint: 'Fills the page behind your profile.' },
  shot: { label: 'Screenshot', maxMb: 4, maxSide: 1920, hint: 'The end-of-match stats screen.' },
};

const storageHost = useEmulators ? `http://${location.hostname}:${emulatorPorts.storage}` : 'https://firebasestorage.googleapis.com';
const storageBase = `${storageHost}/v0/b/${firebaseConfig.storageBucket}/o/`;
const workerBase = useEmulators ? `http://${location.hostname}:${emulatorPorts.worker}` : authWorkerUrl.replace(/\/$/, '');

// Public address of a stored file (or null).
export function mediaUrl(path) {
  if (!path) return null;
  return `${storageBase}${encodeURIComponent(path)}?alt=media`;
}

// Where an older picture lived (the Cloudflare Worker).
export function oldMediaUrl(path) {
  return `${workerBase}/media/${String(path).split('/').map(encodeURIComponent).join('/')}`;
}

// Any picture that fails to load from Firebase is tried once from the Worker (not moved yet).
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img?.tagName !== 'IMG' || img.dataset.oldTried || !img.src.startsWith(storageBase)) return;
  img.dataset.oldTried = '1';
  img.src = oldMediaUrl(decodeURIComponent(img.src.slice(storageBase.length).split('?')[0]));
}, true);

let sdk = null;
const storages = {};
async function storageFor(asAdmin) {
  const admin = asAdmin && !usingDiscordAdmin(); // Discord admins use their player sign-in
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

const CACHE = 'public, max-age=31536000, immutable'; // every upload has its own name

async function put(path, blob, type, admin, label) {
  const storage = await storageFor(admin);
  try {
    await sdk.uploadBytes(sdk.ref(storage, path), blob, { contentType: type, cacheControl: CACHE });
  } catch (err) {
    console.error(err);
    if (err.code === 'storage/unauthorized') throw new FriendlyError(`${label}: you can’t upload that here (too big, or not your profile).`);
    throw new FriendlyError(`${label}: upload failed. Check your connection and try again.`);
  }
}

// Uploads a prepared image. owner: 'teams' | 'players'. Returns the new file's path.
// Safety net: if Firebase refuses (e.g. its permission to check the database isn't set up yet),
// the picture goes to the Cloudflare Worker instead, which checks ownership itself. Pages show it
// either way (see the "error" listener above), and "Move images" copies it into Firebase later.
export async function uploadImage({ owner, id, kind, image, admin = false }) {
  const name = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const path = `${owner}/${id}/${kind}/${name}.${image.ext}`;
  try {
    await put(path, image.blob, image.type, admin, MEDIA[kind].label);
  } catch (err) {
    if (!(err instanceof FriendlyError) || !/can’t upload/.test(err.message)) throw err;
    await putToWorker(path, image, admin, MEDIA[kind].label);
  }
  return path;
}

async function putToWorker(path, image, admin, label) {
  const { auth, adminAuth } = await import('./auth.js');
  const user = (admin && !usingDiscordAdmin() ? adminAuth : auth).currentUser;
  if (!user) throw new FriendlyError('Please sign in again, then try once more.');
  let res;
  try {
    res = await fetch(oldMediaUrl(path), {
      method: 'PUT',
      headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': image.type },
      body: image.blob,
    });
  } catch {
    throw new FriendlyError(`${label}: upload failed. Check your connection and try again.`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new FriendlyError(`${label}: ${body.error ?? 'upload failed. Please try again.'}`);
  }
}

// Removes a stored file. Missing files are fine (already gone).
export async function deleteImage(path, { admin = false } = {}) {
  if (!path) return;
  try {
    const storage = await storageFor(admin);
    await sdk.deleteObject(sdk.ref(storage, path));
  } catch (err) {
    if (err?.code !== 'storage/object-not-found') console.warn('Couldn’t remove image', path, err);
  }
}

// ---------- Moving older pictures from the Worker into Firebase (admins, once) ----------

// Is this picture already in Firebase?
export async function inFirebase(path) {
  const storage = await storageFor(true);
  try {
    await sdk.getMetadata(sdk.ref(storage, path));
    return true;
  } catch (err) {
    if (err?.code === 'storage/object-not-found') return false;
    throw err;
  }
}

// Copies one picture from the Worker into Firebase under the same path (so nothing else changes).
export async function copyOldImage(path) {
  const res = await fetch(oldMediaUrl(path));
  if (res.status === 404) return 'missing';
  if (!res.ok) throw new Error(`Couldn’t fetch ${path} (${res.status})`);
  const blob = await res.blob();
  await put(path, blob, res.headers.get('Content-Type') || blob.type, true, path);
  return 'copied';
}
