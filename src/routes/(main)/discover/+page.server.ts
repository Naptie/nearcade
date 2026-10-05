import { loadShops } from '$lib/endpoints/discover.server';
import { parseShopFilterParam } from '$lib/utils/shops/filter';
import { buildRegionLabelIndex } from '$lib/utils/region.server';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const result = await loadShops(event);

  // The filter panel stores region IDs; chips need localized names. Resolved
  // here (shared with the shops page) so a shared `f` link renders readable
  // regions on discover instead of raw IDs like `CN-321003`.
  const filter = parseShopFilterParam(event.url.searchParams.get('f'));

  return {
    ...result,
    regionLabels: (await buildRegionLabelIndex(filter?.regions)).labels
  };
};
