import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const messagesDir = path.resolve(__dirname, '../messages');
const locales = fs.readdirSync(messagesDir).filter((f) => f.endsWith('.json'));

function compareKeys(keysA: string[], keysB: string[]) {
  const onlyA = keysA.filter((k) => !keysB.includes(k));
  const onlyB = keysB.filter((k) => !keysA.includes(k));
  const both = keysA.filter((k) => keysB.includes(k));
  return { onlyA, onlyB, both };
}

function main() {
  const localeKeys: Record<string, string[]> = {};
  const localeJsons: Record<string, string | object> = {};
  for (const locale of locales) {
    const filePath = path.join(messagesDir, locale);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const json = JSON.parse(raw);
    localeJsons[locale] = json;
    localeKeys[locale] = Object.keys(json)
      .filter((k) => k !== '$schema' && k !== 'locale_name')
      .sort((a, b) => a.localeCompare(b));
  }

  // Compare all pairs
  for (let i = 0; i < locales.length; i++) {
    for (let j = i + 1; j < locales.length; j++) {
      const a = locales[i],
        b = locales[j];
      const { onlyA, onlyB, both } = compareKeys(localeKeys[a], localeKeys[b]);
      console.log(`\n--- Comparing ${a} vs ${b} ---`);
      console.log(`Keys only in ${a}:`, onlyA.length);
      if (onlyA.length) console.log(onlyA);
      console.log(`Keys only in ${b}:`, onlyB.length);
      if (onlyB.length) console.log(onlyB);
      console.log(`Keys in both:`, both.length);
    }
  }

  // Optionally, print sorted keys for each locale
  for (const locale of locales) {
    console.log(`\nSorted keys in ${locale}:`);
    console.log(localeKeys[locale]);
  }

  // Write sorted files if --write is passed
  if (process.argv.includes('--write')) {
    for (const locale of locales) {
      const json = localeJsons[locale];
      const sorted: Record<string, string | object> = {};
      if (json['$schema']) sorted['$schema'] = json['$schema'];
      if (json['locale_name']) sorted['locale_name'] = json['locale_name'];
      for (const key of localeKeys[locale]) {
        sorted[key] = json[key];
      }
      fs.writeFileSync(
        path.join(messagesDir, locale),
        JSON.stringify(sorted, null, 2) + '\n',
        'utf-8'
      );
      console.log(`\nWrote sorted keys to ${locale}`);
    }
  }
}

main();
