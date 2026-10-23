import { createServerApiClient } from '$lib/api/server-client';
import { parseShopFilterParam } from '$lib/utils/shops/filter';
import { buildRegionLabelIndex } from '$lib/utils/region.server';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  // The page asks for the same data the API serves, through the same
  // contract — the query string of the page request is the query of the
  // endpoint.
  const result = await createServerApiClient().discover.list(
    Object.fromEntries(event.url.searchParams)
  );

  // The filter panel stores region IDs; chips need localized names. Resolved
  // here (shared with the shops page) so a shared `f` link renders readable
  // regions on discover instead of raw IDs like `CN-321003`.
  const filter = parseShopFilterParam(event.url.searchParams.get('f'));

  return {
    ...result,
    regionLabels: (await buildRegionLabelIndex(filter?.regions)).labels
  };
};
