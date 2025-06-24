import { PAGINATION } from '$lib/constants';
import type { SortCriteria, RadiusFilter } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch, url }) => {
  try {
    // Get query parameters - only sortBy and radius matter for initial load
    const sortBy = (url.searchParams.get('sortBy') as SortCriteria) || 'shops';
    const radius = parseInt(url.searchParams.get('radius') || '10') as RadiusFilter;
    const refresh = url.searchParams.get('refresh') === 'true';

    // Always start with page 0 for initial load
    const apiUrl = new URL('/api/rankings', url.origin);
    apiUrl.searchParams.set('sortBy', sortBy);
    apiUrl.searchParams.set('radius', radius.toString());
    apiUrl.searchParams.set('page', '0');
    apiUrl.searchParams.set('pageSize', PAGINATION.PAGE_SIZE.toString());
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
      currentPage: result.currentPage,
      cached: result.cached,
      cacheTime: new Date(result.cacheTime),
      stale: result.stale || false,
      sortBy,
      radius
    };
  } catch (error) {
    console.error('Error loading rankings:', error);
    return {
      rankings: [],
      totalCount: 0,
      hasMore: false,
      currentPage: 0,
      cached: false,
      cacheTime: new Date(),
      stale: false,
      error: 'Failed to load rankings',
      sortBy: 'shops' as SortCriteria,
      radius: 10 as RadiusFilter,
      page: 0
    };
  }
};
