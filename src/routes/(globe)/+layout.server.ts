import type { LayoutServerLoad } from './$types';
import { readGlobeFilterState } from '$lib/utils/shops/filter';
import { buildRegionLabelIndex } from '$lib/utils/region.server';

export const load: LayoutServerLoad = async ({ depends, url }) => {
  depends('app:globe-shops');

  // Globe shop data is now fetched client-side via /api/globe/markers (lightweight)
  // and /api/globe/shops?ids=... (on-demand details) to avoid serializing ~6.7MB
  // of shop data into the SSR HTML payload.
  //
  // What the globe *is* handed is its URL state, resolved once here. It is one
  // long-lived client-side app, so the filter has to be ready to use: the `f`
  // parameter plus any legacy `region` folded into `regions`, and the localized
  // names for exactly those regions. Resolving both here is what stops a
  // selection reached through a link from rendering as a raw ID (`CN-321003`)
  // in the sidebar, the breadcrumb or the filter panel — the same rule the
  // shops and discover pages resolve their own chips with.
  const globeFilter = readGlobeFilterState(url.searchParams) ?? null;

  return {
    globeShopData: null,
    globeFilter,
    globeRegionIndex: await buildRegionLabelIndex(globeFilter?.regions)
  };
};
