import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ depends }) => {
  depends('app:globe-shops');

  // Globe shop data is now fetched client-side via /api/globe/markers (lightweight)
  // and /api/globe/shops?ids=... (on-demand details) to avoid serializing ~6.7MB
  // of shop data into the SSR HTML payload.
  return {
    globeShopData: null
  };
};
