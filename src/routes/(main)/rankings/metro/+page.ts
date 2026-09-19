import { resolve } from '$app/paths';
import { env } from '$env/dynamic/public';
import { PAGINATION, METRO_RANKING_RADIUS_OPTIONS } from '$lib/constants';
import type { MetroRankingRadiusFilter } from '$lib/types';
import { metroRankingQuerySchema, metroRankingResponseSchema } from '$lib/schemas/metro';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, url }) => {
  const sort = metroRankingQuerySchema.shape.sortBy.safeParse(
    url.searchParams.get('sortBy') ?? undefined
  );
  const network = metroRankingQuerySchema.shape.networkId.safeParse(
    url.searchParams.get('networkId') ?? undefined
  );
  const radiusParam = Number(
    url.searchParams.get('radius') || String(METRO_RANKING_RADIUS_OPTIONS.at(-1))
  );
  const radius = (METRO_RANKING_RADIUS_OPTIONS as readonly number[]).includes(radiusParam)
    ? (radiusParam as MetroRankingRadiusFilter)
    : METRO_RANKING_RADIUS_OPTIONS.at(-1)!;
  const sortBy = sort.success ? sort.data : 'shops';
  const networkId = network.success ? network.data : undefined;

  try {
    // Always start at the first page, including on back/forward navigation.
    const apiUrl = new URL(resolve('/api/rankings/metro'), env.PUBLIC_API_BASE || url.origin);
    apiUrl.searchParams.set('sortBy', sortBy);
    apiUrl.searchParams.set('radius', String(radius));
    apiUrl.searchParams.set('limit', String(Math.min(PAGINATION.RANKING_PAGE_SIZE, 100)));
    if (networkId) apiUrl.searchParams.set('networkId', networkId);

    const response = await fetch(apiUrl);
    if (!response.ok) throw new Error(`Metro rankings request failed: ${response.status}`);
    const result = metroRankingResponseSchema.parse(await response.json());

    return {
      rankings: result.data,
      totalCount: result.totalCount,
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
      cached: result.cached,
      cacheTime: result.cacheTime ? new Date(result.cacheTime) : new Date(),
      stale: result.stale,
      calculating: result.calculating,
      networks: result.networks,
      sortBy,
      radius,
      networkId,
      error: false
    };
  } catch (error) {
    console.error('Error loading metro rankings:', error);
    return {
      rankings: [],
      totalCount: 0,
      hasMore: false,
      nextCursor: null,
      cached: false,
      cacheTime: new Date(),
      stale: false,
      calculating: false,
      networks: [],
      sortBy,
      radius,
      networkId,
      error: true
    };
  }
};
