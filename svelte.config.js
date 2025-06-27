import adapter from '@sveltejs/adapter-auto';
import cfAdapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const isCloudflare = process.env.ADAPTER === 'cloudflare';

const config = {
  preprocess: vitePreprocess(),
  kit: { adapter: isCloudflare ? cfAdapter() : adapter() }
};

export default config;
