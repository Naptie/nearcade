import { implement } from '@orpc/server';
import { rankingsContract } from '../contracts/rankings';
import { campusRankingResponseSchema, regionRankingResponseSchema } from '$lib/schemas/rankings';
import type { ApiContext } from '../context';
import { apiError, rethrowApiError, toWire } from '../errors';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { PAGINATION, isPoiSortKey, metroRankingSortKey } from '$lib/constants';
import { expandRegionHierarchyWithNames } from '$lib/regions/utils.server';
import { isRegionLevel } from '$lib/regions/types';
import { type MetroRankingResponse, type MetroStationRanking } from '$lib/schemas/metro';
import type { RegionRankingData, UniversityRankingData } from '$lib/types';
import type { RadiusFilter } from '$lib/types/index.server';

interface CacheMetadata {
  _id: string;
  createdAt: Date;
  expiresAt: Date;
  totalCount: number;
  isCalculating?: boolean;
  calculationStarted?: Date;
  networks?: MetroRankingResponse['networks'];
}

interface CachedRanking extends UniversityRankingData {
  rankOrder: { [key: string]: number };
  ranks?: { [key: string]: number };
}

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
  ranks?: { [key: string]: number }; // sortBy -> tied display rank
}

const impl = implement(rankingsContract).$context<ApiContext>();

export const rankingsImplementation = {
  campus: impl.campus.handler(async ({ input }) => {
    try {
      const db = mongo.db();
      const cacheCollection = db.collection('campus_rankings');

      // The legacy handler parsed the raw query string, so the parsing rules
      // (fallbacks, `parseInt` semantics) are kept exactly as they were.
      const sortBy = isPoiSortKey(input.sortBy) ? input.sortBy : 'shops';
      const radiusFilter = parseInt(input.radius || '10') as RadiusFilter;
      const limit = parseInt(input.limit || '') || PAGINATION.RANKING_PAGE_SIZE;
      const after = input.after || null;

      // Check cache metadata
      const metadata = (await cacheCollection.findOne({
        _id: 'metadata'
      } as never)) as CacheMetadata | null;
      const now = new Date();

      // If there is no metadata, it means the first calculation hasn't run yet.
      if (!metadata) {
        return toWire(campusRankingResponseSchema, {
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
          rankings: ranking.rankings,
          // Tied display rank for the requested (sortBy, radius); `rankOrder`
          // stays the unique ordinal used for cursor pagination.
          rank: ranking.ranks?.[sortKey] ?? null
        }));

        return toWire(campusRankingResponseSchema, {
          data: responseData,
          totalCount: metadata.totalCount,
          hasMore,
          nextCursor,
          cached: true,
          cacheTime: metadata.createdAt.toISOString(),
          stale: metadata.expiresAt < now
        });
      } else {
        // Cache exists but is empty
        return toWire(campusRankingResponseSchema, {
          data: [],
          totalCount: 0,
          hasMore: false,
          nextCursor: null,
          cached: true,
          cacheTime: metadata.createdAt.toISOString(),
          stale: metadata.expiresAt < now,
          calculating: metadata.isCalculating
        });
      }
    } catch (err) {
      rethrowApiError(err, m.failed_to_get_rankings());
    }
  }),

  metro: impl.metro.handler(async ({ input }) => {
    try {
      const { networkId, sortBy, radius, limit, after } = input;
      const db = mongo.db();
      const collection = db.collection<MetroStationRanking>('metro_station_rankings');
      const metadata = await db
        .collection<CacheMetadata>('metro_station_rankings')
        .findOne({ _id: 'metadata' });

      if (!metadata) {
        return {
          data: [],
          totalCount: 0,
          hasMore: false,
          nextCursor: null,
          cached: false,
          cacheTime: null,
          stale: true,
          calculating: true,
          networks: []
        } satisfies MetroRankingResponse;
      }

      const filter = {
        _id: { $ne: 'metadata' },
        ...(networkId ? { networkId } : {})
      };
      // Dot-safe composite rank key: one deterministic global order position per
      // (sort criterion, radius) pair, assigned by the sync task. Decimal
      // radii are encoded in centimetres — Mongo paths split on '.'.
      const sortKeyName = metroRankingSortKey(sortBy, radius);
      const sortKey = `rankOrder.${sortKeyName}`;
      // rankOrder is unique globally per (sortBy, radius) key, including when a
      // network filter leaves gaps. Never add the cursor to the count filter or
      // renumber a filtered page. The parallel `ranks` map carries the tied
      // display rank (equal metrics share a rank).
      const query = {
        ...filter,
        ...(after !== undefined ? { [sortKey]: { $gt: Number(after) } } : {})
      };
      const [rankings, totalCount] = await Promise.all([
        collection
          .find(query)
          .sort({ [sortKey]: 1 })
          .limit(limit + 1)
          .toArray(),
        collection.countDocuments(filter)
      ]);
      const hasMore = rankings.length > limit;
      const data = rankings.slice(0, limit).map((ranking) => ({
        ...ranking,
        rank: ranking.ranks?.[sortKeyName] ?? null
      }));

      return {
        data,
        totalCount,
        hasMore,
        nextCursor: hasMore ? String(data[data.length - 1].rankOrder[sortKeyName]) : null,
        cached: true,
        cacheTime: metadata.createdAt.toISOString(),
        stale: metadata.expiresAt.getTime() <= Date.now(),
        calculating: metadata.isCalculating ?? false,
        networks: metadata.networks ?? []
      } satisfies MetroRankingResponse;
    } catch (err) {
      rethrowApiError(err, m.failed_to_get_rankings());
    }
  }),

  region: impl.region.handler(async ({ input }) => {
    try {
      const db = mongo.db();
      const cacheCollection = db.collection('region_rankings');

      // The legacy handler parsed the raw query string, so the parsing rules
      // (fallbacks, `parseInt` semantics) are kept exactly as they were. An
      // unknown sort key falls back to `shops`, the same way the campus
      // ranking does — the value reaches a Mongo field path, so it is checked
      // rather than cast.
      const sortBy = isPoiSortKey(input.sortBy) ? input.sortBy : 'shops';
      const level = input.level || 'country';
      const limit = parseInt(input.limit || '') || PAGINATION.RANKING_PAGE_SIZE;
      const after = input.after || null;

      if (!isRegionLevel(level)) {
        apiError('BAD_REQUEST', m.unknown());
      }

      const metadata = (await cacheCollection.findOne({
        _id: 'metadata'
      } as never)) as RegionRankingsCacheMetadata | null;
      const now = new Date();

      if (!metadata) {
        return toWire(regionRankingResponseSchema, {
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
        const sortKey = sortBy;
        // Street-level towns are grouped under the county tab: the county level
        // query includes street documents too.
        const query: Record<string, unknown> = { _id: { $ne: 'metadata' } };
        query.level = level === 'county' ? { $in: ['county', 'street'] } : level;

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

        const responseData: RegionRankingData[] = await Promise.all(
          rankings.map(async (ranking) => {
            let regionChain: { id: string; name: Record<string, string> }[];
            try {
              regionChain = await expandRegionHierarchyWithNames(ranking.id);
            } catch {
              regionChain = [];
            }

            return {
              id: ranking.id,
              level: ranking.level,
              name: ranking.name,
              country: ranking.country,
              province: ranking.province,
              city: ranking.city,
              county: ranking.county,
              regionChain,
              location: ranking.location,
              area: ranking.area ?? null,
              population: ranking.population ?? null,
              shopCount: ranking.shopCount,
              totalMachines: ranking.totalMachines,
              areaDensity: ranking.areaDensity ?? null,
              machinesPerCapita: ranking.machinesPerCapita ?? null,
              gameSpecificMachines: ranking.gameSpecificMachines,
              // Tied display rank for the requested sort; `rankOrder` stays the
              // unique ordinal used for cursor pagination.
              rank: ranking.ranks?.[sortKey] ?? null
            };
          })
        );

        return toWire(regionRankingResponseSchema, {
          data: responseData,
          totalCount: metadata.totalCount,
          hasMore,
          nextCursor,
          cached: true,
          cacheTime: metadata.createdAt.toISOString(),
          stale: metadata.expiresAt < now
        });
      } else {
        return toWire(regionRankingResponseSchema, {
          data: [],
          totalCount: 0,
          hasMore: false,
          nextCursor: null,
          cached: true,
          cacheTime: metadata.createdAt.toISOString(),
          stale: metadata.expiresAt < now,
          calculating: metadata.isCalculating
        });
      }
    } catch (err) {
      rethrowApiError(err, m.failed_to_get_rankings());
    }
  })
};
