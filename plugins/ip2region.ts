import { existsSync } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

const XDB_SRC_DIR = resolve('src/lib/assets/ip2region');

const FILES = [
  {
    name: 'ip2region_v4.xdb',
    url: 'https://github.com/lionsoul2014/ip2region/raw/master/data/ip2region_v4.xdb'
  },
  {
    name: 'ip2region_v6.xdb',
    url: 'https://github.com/lionsoul2014/ip2region/raw/master/data/ip2region_v6.xdb'
  }
] as const;

export function ip2region(): Plugin {
  return {
    name: 'ip2region',
    async buildStart() {
      await mkdir(XDB_SRC_DIR, { recursive: true });

      for (const file of FILES) {
        const dest = resolve(XDB_SRC_DIR, file.name);
        if (existsSync(dest)) continue;

        console.log(`[ip2region] Downloading ${file.name}...`);
        const res = await fetch(file.url);
        if (!res.ok) {
          this.warn(`[ip2region] Failed to download ${file.name}: HTTP ${res.status}`);
          continue;
        }
        await writeFile(dest, Buffer.from(await res.arrayBuffer()));
        console.log(`[ip2region] Saved ${file.name}`);
      }
    },
    async writeBundle() {
      const destDir = resolve('data', 'ip2region');
      await mkdir(destDir, { recursive: true });

      for (const file of FILES) {
        const src = resolve(XDB_SRC_DIR, file.name);
        const dest = resolve(destDir, file.name);
        if (existsSync(src)) {
          await copyFile(src, dest);
          console.log(`[ip2region] Copied ${file.name} to ${destDir}`);
        }
      }
    }
  };
}
