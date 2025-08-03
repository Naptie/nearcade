import adapterAuto from '@sveltejs/adapter-auto';
import adapterNode from '@sveltejs/adapter-node';
import adapterStatic from '@sveltejs/adapter-static';
import adapterCloudflare from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const isNode = process.env.ADAPTER === 'node';
const isCloudflare = process.env.ADAPTER === 'cloudflare';
const hasApiBase = process.env.PUBLIC_API_BASE && process.env.PUBLIC_API_BASE.trim() !== '';
const base = process.env.PATH_BASE || '';

const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: isNode
      ? adapterNode()
      : isCloudflare
        ? adapterCloudflare()
        : hasApiBase
          ? adapterStatic({
              pages: 'build',
              assets: 'build',
              fallback: 'index.html',
              precompress: false,
              strict: true
            })
          : adapterAuto(),
    paths: {
      base
    },
    prerender: {
      entries: [`${base}/`, `${base}/discover`, `${base}/rankings`]
    }
  }
};

export default config;
