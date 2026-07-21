import { env } from '$env/dynamic/public';
import { PAGINATION } from '$lib/constants';
import type { SortCriteria, RegionLevel, RegionRankingResponse } from '$lib/types';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, url }) => {
  try {
    const sortBy = (url.searchParams.get('sortBy') as SortCriteria) || 'shops';
    const level = (url.searchParams.get('level') as RegionLevel) || 'country';

    const apiUrl = new URL('/api/rankings/region', env.PUBLIC_API_BASE || url.origin);
    apiUrl.searchParams.set('sortBy', sortBy);
    apiUrl.searchParams.set('level', level);
    apiUrl.searchParams.set('limit', PAGINATION.RANKING_PAGE_SIZE.toString());

    const response = await fetch(apiUrl.toString());

    if (!response.ok) {
      throw new Error(`API call failed: ${response.status}`);
    }

    const result = (await response.json()) as RegionRankingResponse;

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
      sortBy: 'shops' as SortCriteria,
      level: 'country' as RegionLevel
    };
  }
};
