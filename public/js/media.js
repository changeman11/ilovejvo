// Profile images: team logos, player pictures, banners and page backgrounds (GIFs allowed).
// Files are stored by our Cloudflare Worker (free, no card; see worker/src/media.js).
// The database only keeps each file's path, e.g. "teams/x/logo/abc.gif".

import { auth, adminAuth } from './auth.js';
import { authWorkerUrl, useEmulators, emulatorPorts } from './config.js';

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
};

// On this computer the Worker runs locally (wrangler dev).
const base = useEmulators ? `http://${location.hostname}:${emulatorPorts.worker}` : authWorkerUrl.replace(/\/$/, '');

// Public address of a stored file (or null).
export function mediaUrl(path) {
  if (!path) return null;
  return `${base}/media/${String(path).split('/').map(encodeURIComponent).join('/')}`;
}

// The signed-in person's token, so the Worker knows who is uploading.
async function tokenFor(admin) {
  const user = (admin ? adminAuth : auth).currentUser;
  if (!user) throw new FriendlyError('Please sign in again, then try once more.');
  return user.getIdToken();
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
  const name = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const path = `${owner}/${id}/${kind}/${name}.${image.ext}`;
  const token = await tokenFor(admin);
  let res;
  try {
    res = await fetch(mediaUrl(path), {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': image.type },
      body: image.blob,
    });
  } catch (err) {
    console.error(err);
    throw new FriendlyError(`${MEDIA[kind].label}: upload failed. Check your connection and try again.`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new FriendlyError(`${MEDIA[kind].label}: ${body.error ?? 'upload failed. Please try again.'}`);
  }
  return path;
}

// Removes a stored file. Missing files are fine (already gone).
export async function deleteImage(path, { admin = false } = {}) {
  if (!path) return;
  try {
    const res = await fetch(mediaUrl(path), { method: 'DELETE', headers: { Authorization: `Bearer ${await tokenFor(admin)}` } });
    if (!res.ok && res.status !== 404) console.warn('Couldn’t remove old image', path, res.status);
  } catch (err) {
    console.warn('Couldn’t remove old image', path, err);
  }
}
