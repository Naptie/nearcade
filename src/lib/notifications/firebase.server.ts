import { env } from '$env/dynamic/private';
import { cert, initializeApp, type App } from 'firebase-admin/app';

let app: App | null;

const initialize = () => {
  if (!env.GSAK_BASE64) return null;
  const decoded = Buffer.from(env.GSAK_BASE64, 'base64').toString('utf8');
  const serviceAccount = JSON.parse(decoded);
  console.log(serviceAccount);
  return initializeApp({
    credential: cert(serviceAccount)
  });
};

if (process.env.NODE_ENV === 'development') {
  // In development mode, use a global variable so that the value
  // is preserved across module reloads caused by HMR (Hot Module Replacement).
  const globalWithFirebase = global as typeof globalThis & {
    _firebaseApp?: App | null;
  };

  if (!globalWithFirebase._firebaseApp) {
    globalWithFirebase._firebaseApp = initialize();
  }
  app = globalWithFirebase._firebaseApp;
} else {
  // In production mode, it's best to not use a global variable.
  app = initialize();
}

// Export a module-scoped Firebase app. By doing this in a
// separate module, the app can be shared across functions.
export default app;
