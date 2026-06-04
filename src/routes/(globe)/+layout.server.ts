import { base } from '$app/paths';
import { loadGlobeShops } from '$lib/endpoints/globe.server';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ depends, url }) => {
  depends('app:globe-shops');
  const isGlobePage = url.pathname === `${base}/globe`;

  return {
    globeShopData: isGlobePage ? loadGlobeShops() : null
  };
};
