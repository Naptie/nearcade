import type { Plugin } from 'vite';

const REPLACEMENTS = [
  {
    from: 'https://firebaseinstallations.googleapis.com/v1',
    to: 'https://firebaseinstallations.phi.zone/v1',
    label: 'installations'
  },
  {
    from: 'https://fcmregistrations.googleapis.com/v1',
    to: 'https://fcmregistrations.phi.zone/v1',
    label: 'fcm-registrations'
  },
  {
    from: 'https://firebase.googleapis.com',
    to: 'https://firebase.phi.zone',
    label: 'firebase-config'
  }
] as const;

const GA_TRANSPORT_URL = 'https://google-analytics.phi.zone';
const GTAG_CONFIG_ORIGIN = 'origin="firebase"';
const GTAG_CONFIG_INJECTED = `origin="firebase",transport_url="${GA_TRANSPORT_URL}"`;

export function firebaseProxy(): Plugin {
  return {
    name: 'firebase-proxy',
    generateBundle(_options, bundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk' || typeof chunk.code !== 'string') continue;
        for (const { from, to, label } of REPLACEMENTS) {
          if (chunk.code.includes(from)) {
            const count = chunk.code.split(from).length - 1;
            chunk.code = chunk.code.replaceAll(from, to);
            console.log(`[firebase-proxy] ${fileName}: replaced ${count} ${label} URL(s)`);
          }
        }
        if (chunk.code.includes(GTAG_CONFIG_ORIGIN)) {
          chunk.code = chunk.code.replace(GTAG_CONFIG_ORIGIN, GTAG_CONFIG_INJECTED);
          console.log(`[firebase-proxy] ${fileName}: injected gtag transport_url`);
        }
      }
    }
  };
}
