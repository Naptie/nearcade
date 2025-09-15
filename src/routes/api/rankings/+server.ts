import { isHttpError, json } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { UniversityRankingData, SortCriteria, RadiusFilter } from '$lib/types';
import { PAGINATION } from '$lib/constants';
import mongo from '$lib/db/index.server';

interface CacheMetadata {
  _id: string;
  createdAt: Date;
  expiresAt: Date;
  totalCount: number;
  isCalculating?: boolean;
  calculationStarted?: Date;
}

interface CachedRanking extends UniversityRankingData {
  rankOrder: { [key: string]: number }; // sortBy_radius -> rank
}

export const GET: RequestHandler = async ({ url }) => {
  try {
    const db = mongo.db();
    const cacheCollection = db.collection('rankings');

    const sortBy = (url.searchParams.get('sortBy') as SortCriteria) || 'shops';
    const radiusFilter = parseInt(url.searchParams.get('radius') || '10') as RadiusFilter;
    const limit = parseInt(url.searchParams.get('limit') || '') || PAGINATION.PAGE_SIZE;
    const after = url.searchParams.get('after') || null;

    // Check cache metadata
    const metadata = (await cacheCollection.findOne({
      _id: 'metadata'
    } as never)) as CacheMetadata | null;
    const now = new Date();

    // If there is no metadata, it means the first calculation hasn't run yet.
    if (!metadata) {
      return json({
        data: [],
        totalCount: 0,
        hasMore: false,
        nextCursor: null,
        cached: false,
        cacheTime: null,
        stale: true,
        calculating: true // Assume it's being calculated for the first time
      });
    }

    // Serve from cache if it exists
    if (metadata.totalCount > 0) {
      const sortKey = `${sortBy}_${radiusFilter}`;
      const query: Record<string, unknown> = { _id: { $ne: 'metadata' } };

      if (after) {
        const afterRank = parseInt(after);
        query[`rankOrder.${sortKey}`] = { $gt: afterRank };
      }

      const rankings = (await cacheCollection
        .find(query)
        .sort({ [`rankOrder.${sortKey}`]: 1 })
        .limit(limit + 1)
        .toArray()) as unknown as CachedRanking[];

      const hasMore = rankings.length > limit;
      if (hasMore) {
        rankings.pop();
      }

      const nextCursor =
        hasMore && rankings.length > 0
          ? rankings[rankings.length - 1].rankOrder[sortKey]?.toString()
          : null;

      // Convert to response format
      const responseData: UniversityRankingData[] = rankings.map((ranking) => ({
        id: ranking.id,
        universityName: ranking.universityName,
        campusName: ranking.campusName,
        fullName: ranking.fullName,
        type: ranking.type,
        majorCategory: ranking.majorCategory,
        natureOfRunning: ranking.natureOfRunning,
        affiliation: ranking.affiliation,
        is985: ranking.is985,
        is211: ranking.is211,
        isDoubleFirstClass: ranking.isDoubleFirstClass,
        province: ranking.province,
        city: ranking.city,
        district: ranking.district,
        address: ranking.address,
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
      // Cache exists but is empty
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
    console.error('Error getting rankings:', err);
    if (err && isHttpError(err)) {
      throw err;
    }
    error(500, 'Failed to get rankings');
  }
};
