import { PAGINATION, RANKING_RADIUS_OPTIONS, isPoiSortKey } from '$lib/constants';
import { createServerApiClient } from '$lib/api/client.server';
import type { SortCriteria, RankingRadiusFilter } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
  // Get query parameters - only sortBy and radius matter for initial load.
  // Per-capita has no meaning for a campus, so unknown/stale keys fall back.
  const requestedSortBy = url.searchParams.get('sortBy');
  const sortBy = isPoiSortKey(requestedSortBy) ? requestedSortBy : 'shops';

  // The radius is checked against the supported options rather than parsed and
  // trusted: `parseInt('abc')` is `NaN`, and `String(NaN)` would then be sent to
  // the procedure as the literal `"NaN"`.
  const requestedRadius = Number(url.searchParams.get('radius'));
  const radius = (RANKING_RADIUS_OPTIONS as readonly number[]).includes(requestedRadius)
    ? (requestedRadius as RankingRadiusFilter)
    : 10;

  try {
    const result = await createServerApiClient().rankings.campus({
      sortBy,
      radius: radius.toString(),
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
      radius
    };
  } catch (error) {
    console.error('Error loading rankings:', error);
    return {
      rankings: [],
      totalCount: 0,
      hasMore: false,
      nextCursor: null,
      cached: false,
      cacheTime: new Date(),
      stale: false,
      calculating: false,
      error: 'Failed to load rankings',
      sortBy: 'shops' as SortCriteria,
      radius: 10 as RankingRadiusFilter
    };
  }
};
