import adapter from '@sveltejs/adapter-auto';
import cfAdapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const isCloudflare = process.env.ADAPTER === 'cloudflare';
console.log('Adapter:', process.env.ADAPTER, isCloudflare);

const config = {
  preprocess: vitePreprocess(),
  kit: { adapter: isCloudflare ? cfAdapter() : cfAdapter() }
};

export default config;
