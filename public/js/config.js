// Firebase web config. This is NOT secret: Firebase web config is meant to be public,
// and the security rules (firestore.rules) are what protect the data.

// Use the local emulators when the site is opened from this computer.
export const useEmulators = ['localhost', '127.0.0.1'].includes(location.hostname);
export const emulatorPorts = { firestore: 8080, auth: 9099 };

// Local testing: a "demo-" project that only exists in the emulator.
const emulatorConfig = {
  apiKey: 'demo-key',
  authDomain: 'demo-jvo-hub.firebaseapp.com',
  projectId: 'demo-jvo-hub',
  appId: 'demo-app',
};

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

// Discord sign-in for players (both public, not secrets).
// Discord Developer Portal -> your app -> OAuth2 -> Client ID.
export const discordClientId = '';
// The Cloudflare Worker's address, e.g. https://ilovejvo-auth.<your-name>.workers.dev
export const authWorkerUrl = '';
