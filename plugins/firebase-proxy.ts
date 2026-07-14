import type { Plugin } from 'vite';

const REPLACEMENTS = [
  {
    from: 'https://firebaseinstallations.googleapis.com/v1',
    to: process.env.PUBLIC_FIREBASEINSTALLATIONS_PROXY,
    label: 'installations'
  },
  {
    from: 'https://fcmregistrations.googleapis.com/v1',
    to: process.env.PUBLIC_FCMREGISTRATIONS_PROXY,
    label: 'fcm-registrations'
  },
  {
    from: 'https://firebase.googleapis.com',
    to: process.env.PUBLIC_FIREBASE_PROXY,
    label: 'firebase-config'
  }
] as const;

const GA_TRANSPORT_URL = process.env.PUBLIC_GA_TRANSPORT_URL;
const GTAG_ORIGIN_REGEX = /(\w+)\.origin="firebase"/;

export function firebaseProxy(): Plugin {
  return {
    name: 'firebase-proxy',
    generateBundle(_options, bundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk' || typeof chunk.code !== 'string') continue;
        for (const { from, to, label } of REPLACEMENTS) {
          if (!to) continue;
          if (chunk.code.includes(from)) {
            const count = chunk.code.split(from).length - 1;
            chunk.code = chunk.code.replaceAll(from, to);
            console.log(`[firebase-proxy] ${fileName}: replaced ${count} ${label} URL(s)`);
          }
        }
        if (GA_TRANSPORT_URL && GTAG_ORIGIN_REGEX.test(chunk.code)) {
          chunk.code = chunk.code.replace(
            GTAG_ORIGIN_REGEX,
            `$&,$1.transport_url="${GA_TRANSPORT_URL}"`
          );
          console.log(`[firebase-proxy] ${fileName}: injected gtag transport_url`);
        }
      }
    }
  };
}
