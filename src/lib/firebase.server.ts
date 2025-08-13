import dotenv from 'dotenv';
import { applicationDefault, initializeApp, type App } from 'firebase-admin/app';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
  const envVar = process.env.GSAK_BASE64;
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const filePath = path.join(__dirname, 'google-sak.json');

  if (envVar) {
    if (!fs.existsSync(filePath)) {
      const decoded = Buffer.from(envVar, 'base64').toString('utf8');
      fs.writeFileSync(filePath, decoded, { encoding: 'utf8' });
      console.log('Created google-sak.json.');
    }
  }
  app = initializeApp({
    credential: applicationDefault()
  });
}

// Export a module-scoped Firebase app. By doing this in a
// separate module, the app can be shared across functions.
export default app;
