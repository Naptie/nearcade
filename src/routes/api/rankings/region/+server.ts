import { isHttpError, isRedirect, json } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RegionRankingData, SortCriteria, RadiusFilter, RegionLevel } from '$lib/types';
import { PAGINATION } from '$lib/constants';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';

interface RegionRankingsCacheMetadata {
  _id: string;
  createdAt: Date;
  expiresAt: Date;
  totalCount: number;
  isCalculating?: boolean;
  calculationStarted?: Date;
}

interface CachedRegionRanking extends RegionRankingData {
  rankOrder: { [key: string]: number }; // sortBy_radius -> rank
}

const isValidRegionLevel = (value: string | null): value is RegionLevel => {
  return value === 'country' || value === 'province' || value === 'city' || value === 'county';
};

export const GET: RequestHandler = async ({ url }) => {
  try {
    const db = mongo.db();
    const cacheCollection = db.collection('region_rankings');

    const sortBy = (url.searchParams.get('sortBy') as SortCriteria) || 'shops';
    const radiusFilter = parseInt(url.searchParams.get('radius') || '10') as RadiusFilter;
    const level = url.searchParams.get('level') || 'country';
    const limit = parseInt(url.searchParams.get('limit') || '') || PAGINATION.PAGE_SIZE;
    const after = url.searchParams.get('after') || null;

    if (!isValidRegionLevel(level)) {
      error(400, m.unknown());
    }

    const metadata = (await cacheCollection.findOne({
      _id: 'metadata'
    } as never)) as RegionRankingsCacheMetadata | null;
    const now = new Date();

    if (!metadata) {
      return json({
        data: [],
        totalCount: 0,
        hasMore: false,
        nextCursor: null,
        cached: false,
        cacheTime: null,
        stale: true,
        calculating: true
      });
    }

    if (metadata.totalCount > 0) {
      const sortKey = `${sortBy}_${radiusFilter}`;
      const query: Record<string, unknown> = { _id: { $ne: 'metadata' }, level };

      if (after) {
        const afterRank = parseInt(after);
        query[`rankOrder.${sortKey}`] = { $gt: afterRank };
      }

      const rankings = (await cacheCollection
        .find(query)
        .sort({ [`rankOrder.${sortKey}`]: 1 })
        .limit(limit + 1)
        .toArray()) as unknown as CachedRegionRanking[];

      const hasMore = rankings.length > limit;
      if (hasMore) {
        rankings.pop();
      }

      const nextCursor =
        hasMore && rankings.length > 0
          ? rankings[rankings.length - 1].rankOrder[sortKey]?.toString()
          : null;

      const responseData: RegionRankingData[] = rankings.map((ranking) => ({
        id: ranking.id,
        level: ranking.level,
        name: ranking.name,
        country: ranking.country,
        province: ranking.province,
        city: ranking.city,
        county: ranking.county,
        location: ranking.location,
        rankings: ranking.rankings
      }));

      return json({
        data: responseData,
        totalCount: metadata.totalCount,
        hasMore,
        nextCursor,
        cached: true,
        cacheTime: metadata.createdAt,
        stale: metadata.expiresAt < now
      });
    } else {
      return json({
        data: [],
        totalCount: 0,
        hasMore: false,
        nextCursor: null,
        cached: true,
        cacheTime: metadata.createdAt,
        stale: metadata.expiresAt < now,
        calculating: metadata.isCalculating
      });
    }
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error getting region rankings:', err);
    error(500, m.failed_to_get_rankings());
  }
};
