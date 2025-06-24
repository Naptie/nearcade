import { PAGINATION } from '$lib/constants';
import type { SortCriteria, RadiusFilter } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch, url }) => {
  try {
    // Get query parameters - only sortBy and radius matter for initial load
    const sortBy = (url.searchParams.get('sortBy') as SortCriteria) || 'shops';
    const radius = parseInt(url.searchParams.get('radius') || '10') as RadiusFilter;
    const refresh = url.searchParams.get('refresh') === 'true';

    // Always start with no cursor for initial load (cursor-based pagination)
    const apiUrl = new URL('/api/rankings', url.origin);
    apiUrl.searchParams.set('sortBy', sortBy);
    apiUrl.searchParams.set('radius', radius.toString());
    apiUrl.searchParams.set('limit', PAGINATION.PAGE_SIZE.toString());
    if (refresh) {
      apiUrl.searchParams.set('refresh', 'true');
    }

    const response = await fetch(apiUrl.toString());

    if (!response.ok) {
      throw new Error(`API call failed: ${response.status}`);
    }

    const result = await response.json();

    return {
      rankings: result.data,
      totalCount: result.totalCount,
      hasMore: result.hasMore,
      nextCursor: result.nextCursor || null,
      cached: result.cached,
      cacheTime: new Date(result.cacheTime),
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
      radius: 10 as RadiusFilter
    };
  }
};
