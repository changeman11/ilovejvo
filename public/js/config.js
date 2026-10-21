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
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
};

export const firebaseConfig = useEmulators ? emulatorConfig : liveConfig;
