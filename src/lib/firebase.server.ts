import { GSAK_BASE64 } from '$env/static/private';
import { applicationDefault, cert, initializeApp, type App } from 'firebase-admin/app';

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
  const decoded = Buffer.from(GSAK_BASE64, 'base64').toString('utf8');
  const serviceAccount = JSON.parse(decoded);
  app = initializeApp({
    credential: cert(serviceAccount)
  });
}

// Export a module-scoped Firebase app. By doing this in a
// separate module, the app can be shared across functions.
export default app;
