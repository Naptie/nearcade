import { env } from '$env/dynamic/public';
import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ data, url, fetch }) => {
  if (env.PUBLIC_API_BASE) {
    const resp = await fetch(`${env.PUBLIC_API_BASE}/api/discover${url.search}`);
    if (!resp.ok) {
      error(resp.status, `Failed to fetch shops: ${resp.statusText}`);
    }
    data = await resp.json();
  }
  const { shops, location, radius } = data;

  return {
    shops,
    location,
    radius
  };
};
