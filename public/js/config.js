// Firebase web config. This is NOT secret: Firebase web config is meant to be public,
// and the security rules (firestore.rules) are what protect the data.

// Use the local emulators when the site is opened from this computer.
export const useEmulators = ['localhost', '127.0.0.1'].includes(location.hostname);
// worker: the Cloudflare Worker run locally with `npm run worker` (Discord test logins don't need it).
export const emulatorPorts = { firestore: 8080, auth: 9099, worker: 8787 };

// Local testing: a "demo-" project that only exists in the emulator.
const emulatorConfig = {
  apiKey: 'demo-key',
  authDomain: 'demo-jvo-hub.firebaseapp.com',
  projectId: 'demo-jvo-hub',
  appId: 'demo-app',
};

// Image uploads go through the Cloudflare Worker (images stored in Workers KV).
// Set to true once the Worker with its MEDIA storage is deployed (GO-LIVE.md Part 6).
const liveUploadsReady = true;

// The live site. Firebase console -> Project settings -> Your apps -> Web app -> SDK config.
const liveConfig = {
  apiKey: 'AIzaSyDLQRbRGct6B2LxAjjv6FXznPOzx8f7aHU',
  authDomain: 'i-love-jvo.firebaseapp.com',
  projectId: 'i-love-jvo',
  storageBucket: 'i-love-jvo.firebasestorage.app',
  messagingSenderId: '785799744687',
  appId: '1:785799744687:web:d84f4d3dac39354ccc585a',
};

export const firebaseConfig = useEmulators ? emulatorConfig : liveConfig;
export const uploadsReady = useEmulators || liveUploadsReady;

// The game's Steam page (the "wishlist" button).
export const steamUrl = 'https://store.steampowered.com/app/5037200/';
// JVO's Discord invite link, e.g. 'https://discord.gg/abc123'. Empty = the "discord" button is hidden.
export const discordInviteUrl = 'https://discord.gg/PWXtgFVu2Q';

// Discord sign-in for players (both public, not secrets).
// Discord Developer Portal -> your app -> OAuth2 -> Client ID.
export const discordClientId = '1562397361878343743';
// The Cloudflare Worker's address, e.g. https://ilovejvo-auth.<your-name>.workers.dev
export const authWorkerUrl = 'https://ilovejvo-auth.ilovejvo.workers.dev';
