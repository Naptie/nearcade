import { env } from '$env/dynamic/public';
import { error } from '@sveltejs/kit';
import { m } from '$lib/paraglide/messages';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ data, url, fetch }) => {
  if (env.PUBLIC_API_BASE) {
    const resp = await fetch(`${env.PUBLIC_API_BASE}/api/discover${url.search}`);
    if (!resp.ok) {
      console.error('Failed to fetch shops:', resp.status, resp.statusText);
      error(resp.status, m.failed_to_fetch_shops());
    }
    data = await resp.json();
  }
  const { shops, location, radius, limit, gameTitleIds, metro, regionLabels } = data;

  return {
    shops,
    location,
    radius,
    limit,
    gameTitleIds: gameTitleIds ?? [],
    metro,
    // Localized names for the regions in the `f` parameter. Carried through this
    // projection because the chips render from it, not from the raw IDs.
    regionLabels: regionLabels ?? {}
  };
};
