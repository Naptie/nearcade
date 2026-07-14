import { FCM_PROXY_HOST, GLOAUTH2_PROXY_HOST, GSAK_BASE64 } from '$env/static/private';
import { cert, initializeApp, type App } from 'firebase-admin/app';
import http2 from 'node:http2';
import https from 'node:https';

const originalHttp2Connect = http2.connect;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(http2.connect as any) = (
  authority: string | URL,
  options?: http2.ClientSessionOptions | http2.SecureClientSessionOptions
) => {
  if (typeof authority === 'string' && authority.includes('fcm.googleapis.com')) {
    const redirected = authority.replace('fcm.googleapis.com', FCM_PROXY_HOST);
    return originalHttp2Connect(redirected, options);
  }
  return originalHttp2Connect(authority, options);
};

const originalHttpsRequest = https.request;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(https.request as any) = (
  options: string | URL | https.RequestOptions,
  callback?: (res: import('node:http').IncomingMessage) => void
) => {
  if (
    typeof options !== 'string' &&
    !(options instanceof URL) &&
    options.hostname === 'oauth2.googleapis.com'
  ) {
    options.hostname = GLOAUTH2_PROXY_HOST;
    options.host = GLOAUTH2_PROXY_HOST;
  }
  return originalHttpsRequest(options as Parameters<typeof https.request>[0], callback);
};

let app: App | null;

const initialize = () => {
  if (!GSAK_BASE64) return null;
  const decoded = Buffer.from(GSAK_BASE64, 'base64').toString('utf8');
  const serviceAccount = JSON.parse(decoded);
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
