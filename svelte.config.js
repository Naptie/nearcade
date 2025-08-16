import adapterAuto from '@sveltejs/adapter-auto';
import adapterNode from '@sveltejs/adapter-node';
import adapterVercel from '@sveltejs/adapter-vercel';
import adapterCloudflare from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const isNode = process.env.ADAPTER === 'node';
const isVercel = process.env.ADAPTER === 'vercel';
const isCloudflare = process.env.ADAPTER === 'cloudflare';
const base = process.env.PATH_BASE || '';

const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: isNode
      ? adapterNode()
      : isVercel
        ? adapterVercel()
        : isCloudflare
          ? adapterCloudflare()
          : adapterAuto(),
    paths: {
      base
    }
  }
};

export default config;
