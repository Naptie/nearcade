import adapterAuto from '@sveltejs/adapter-auto';
import adapterNode from '@sveltejs/adapter-node';
import adapterVercel from '@sveltejs/adapter-vercel';
import adapterCloudflare from '@sveltejs/adapter-cloudflare';
import adapterEdgeOne from '@edgeone/sveltekit';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const base = process.env.PATH_BASE || '';

const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: (() => {
      switch (process.env.ADAPTER) {
        case 'node':
          return adapterNode();
        case 'vercel':
          return adapterVercel();
        case 'cloudflare':
          return adapterCloudflare();
        case 'edgeone':
          return adapterEdgeOne();
        default:
          return adapterAuto();
      }
    })(),
    paths: {
      base
    }
  }
};

export default config;
