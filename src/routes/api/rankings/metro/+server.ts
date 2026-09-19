import { error, isHttpError, isRedirect, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { metroRankingSortKey } from '$lib/constants';
import {
  metroRankingQuerySchema,
  type MetroRankingResponse,
  type MetroStationRanking
} from '$lib/schemas/metro';
import { parseQueryOrError } from '$lib/utils/validation.server';

interface CacheMetadata {
  _id: string;
  createdAt: Date;
  expiresAt: Date;
  totalCount: number;
  isCalculating?: boolean;
  calculationStarted?: Date;
  networks?: MetroRankingResponse['networks'];
}

export const GET: RequestHandler = async ({ url }) => {
  try {
    const { networkId, sortBy, radius, limit, after } = parseQueryOrError(
      metroRankingQuerySchema,
      url
    );
    const db = mongo.db();
    const collection = db.collection<MetroStationRanking>('metro_station_rankings');
    const metadata = await db
      .collection<CacheMetadata>('metro_station_rankings')
      .findOne({ _id: 'metadata' });

    if (!metadata) {
      return json({
        data: [],
        totalCount: 0,
        hasMore: false,
        nextCursor: null,
        cached: false,
        cacheTime: null,
        stale: true,
        calculating: true,
        networks: []
      } satisfies MetroRankingResponse);
    }

    const filter = {
      _id: { $ne: 'metadata' },
      ...(networkId ? { networkId } : {})
    };
    // Dot-safe composite rank key: one deterministic global rank per
    // (sort criterion, radius) pair, assigned by the sync task. Decimal
    // radii are encoded in centimetres — Mongo paths split on '.'.
    const sortKeyName = metroRankingSortKey(sortBy, radius);
    const sortKey = `rankOrder.${sortKeyName}`;
    // rankOrder is unique globally per (sortBy, radius) key, including when a
    // network filter leaves gaps. Never add the cursor to the count filter or
    // renumber a filtered page.
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
    const data = rankings.slice(0, limit);

    return json({
      data,
      totalCount,
      hasMore,
      nextCursor: hasMore ? String(data[data.length - 1].rankOrder[sortKeyName]) : null,
      cached: true,
      cacheTime: metadata.createdAt.toISOString(),
      stale: metadata.expiresAt.getTime() <= Date.now(),
      calculating: metadata.isCalculating ?? false,
      networks: metadata.networks ?? []
    } satisfies MetroRankingResponse);
  } catch (err) {
    if (isHttpError(err) || isRedirect(err)) {
      throw err;
    }
    console.error('Error getting metro rankings:', err);
    error(500, m.failed_to_get_rankings());
  }
};
