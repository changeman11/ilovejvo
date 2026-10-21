// Firebase web config. This is NOT secret: Firebase web config is meant to be public,
// and the security rules (firestore.rules) are what protect the data.
//
// While developing we use a "demo-" project that only exists in the local emulator.
// When you create the real Firebase project, paste its web config here
// (Firebase console -> Project settings -> Your apps -> Web app -> Config).

export const firebaseConfig = {
  apiKey: 'demo-key',
  authDomain: 'demo-jvo-hub.firebaseapp.com',
  projectId: 'demo-jvo-hub',
  appId: 'demo-app',
};

// Where the Cloud Functions run (Sydney). Must match setGlobalOptions in functions/index.js.
export const functionsRegion = 'australia-southeast1';

// Discord Developer Portal -> your app -> OAuth2 -> Client ID. Public, not a secret.
// Leave empty until the Discord app exists; the sign-in button explains what's missing.
export const discordClientId = '';

// Use the local emulators when the site is opened from this computer.
export const useEmulators = ['localhost', '127.0.0.1'].includes(location.hostname);
export const emulatorPorts = { firestore: 8080, auth: 9099, functions: 5001 };
