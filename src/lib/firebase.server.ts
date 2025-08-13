import dotenv from 'dotenv';
import { applicationDefault, initializeApp, type App } from 'firebase-admin/app';

if (!('GOOGLE_APPLICATION_CREDENTIALS' in process.env)) {
  // Load environment variables for local development
  dotenv.config();
}

let app: App;

if (process.env.NODE_ENV === 'development') {
  // In development mode, use a global variable so that the value
  // is preserved across module reloads caused by HMR (Hot Module Replacement).
  const globalWithFirebase = global as typeof globalThis & {
    _firebaseApp?: App;
  };

  if (!globalWithFirebase._firebaseApp) {
    globalWithFirebase._firebaseApp = initializeApp({
      credential: applicationDefault()
    });
  }
  app = globalWithFirebase._firebaseApp;
} else {
  // In production mode, it's best to not use a global variable.
  app = initializeApp({
    credential: applicationDefault()
  });
}

// Export a module-scoped Firebase app. By doing this in a
// separate module, the app can be shared across functions.
export default app;
