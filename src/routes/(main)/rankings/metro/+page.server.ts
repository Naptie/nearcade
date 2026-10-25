import { PAGINATION, METRO_RANKING_RADIUS_OPTIONS } from '$lib/constants';
import { createServerApiClient } from '$lib/api/client.server';
import type { MetroRankingRadiusFilter } from '$lib/types';
import { metroRankingQuerySchema } from '$lib/schemas/metro';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
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
    const result = await createServerApiClient().rankings.metro({
      sortBy,
      radius: String(radius),
      limit: String(Math.min(PAGINATION.RANKING_PAGE_SIZE, 100)),
      ...(networkId ? { networkId } : {})
    });

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
