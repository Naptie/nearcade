import { PAGINATION, isPoiSortKey } from '$lib/constants';
import { createServerApiClient } from '$lib/api/client.server';
import { isRegionLevel } from '$lib/regions/types';
import type { PageServerLoad } from './$types';

/**
 * Normalize the two query-string selectors.
 *
 * The load normalizes them so the page can highlight the active option; the
 * procedure applies the same fallbacks, because nothing may depend on the
 * front end for a value that ends up in a Mongo field path. Both use the
 * shared guards (`isPoiSortKey`, `isRegionLevel`) rather than a second copy of
 * the vocabulary — the old copy here was built from `REGION_LEVELS`, which
 * omits `street`, so the two disagreed.
 */
const asSortKey = (value: string | null) => (isPoiSortKey(value) ? value : 'shops');

const asRegionLevel = (value: string | null) => (isRegionLevel(value) ? value : 'country');

export const load: PageServerLoad = async ({ url }) => {
  const sortBy = asSortKey(url.searchParams.get('sortBy'));
  const level = asRegionLevel(url.searchParams.get('level'));

  try {
    const result = await createServerApiClient().rankings.region({
      sortBy,
      level,
      limit: PAGINATION.RANKING_PAGE_SIZE.toString()
    });

    return {
      rankings: result.data,
      totalCount: result.totalCount,
      hasMore: result.hasMore,
      nextCursor: result.nextCursor || null,
      cached: result.cached,
      cacheTime: result.cacheTime ? new Date(result.cacheTime) : new Date(),
      stale: result.stale || false,
      calculating: result.calculating || false,
      sortBy,
      level
    };
  } catch (error) {
    console.error('Error loading region rankings:', error);
    return {
      rankings: [],
      totalCount: 0,
      hasMore: false,
      nextCursor: null,
      cached: false,
      cacheTime: new Date(),
      stale: false,
      calculating: false,
      error: 'Failed to load region rankings',
      sortBy: 'shops' as const,
      level: 'country' as const
    };
  }
};
