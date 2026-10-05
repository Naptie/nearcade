/**
 * Shop query engine: executes a `ShopFilterState` against MongoDB and
 * Meilisearch.
 *
 * The pure translation layer (strategy selection, Mongo/Meili filter
 * builders) lives in `$lib/utils/shops/filter-query.server` so the globe endpoints,
 * the validation script, and this orchestrator share one definition of the
 * semantics. This module only adds the I/O: Mongo queries, Meilisearch
 * search, the attendance join, and the exact per-page post-filters
 * (open-now, activity) that no index can answer.
 *
 * Totals are marked `approximateTotal` when a post-filter narrows a superset
 * (open-now / activity); every other total is exact.
 */
import type { WithId } from 'mongodb';

import mongo from '$lib/db/index.server';
import meili from '$lib/db/meili.server';
import type { Shop } from '$lib/types';
import type { AuthSession } from '$lib/auth/types';
import {
  MEILI_SORTS,
  buildShopMeiliFilter,
  buildShopMongoCountFilter,
  buildShopMongoFilter,
  buildShopMongoPredicate,
  buildTextCondition,
  describeShopSearchStrategy,
  needsPostFilter,
  type ShopSearchStrategy
} from '$lib/utils/shops/filter-query.server';
import { isShopOpenAt } from '$lib/utils/shops/derived';
import {
  getShopsAttendanceData,
  type ShopAttendanceResult
} from '$lib/endpoints/attendance.server';
import type { ShopFilterState, ShopSearchSort } from '$lib/schemas/shop-filter';

export {
  buildShopMeiliFilter,
  buildShopMongoFilter,
  buildTextCondition,
  describeShopSearchStrategy,
  type ShopSearchStrategy
};

export interface ShopSearchParams {
  filter: ShopFilterState;
  q?: string;
  sort?: ShopSearchSort;
  page?: number;
  limit?: number;
  /** Request session; forwarded to the attendance lookup for privacy. */
  session?: AuthSession | null;
  /** Meili attributes to highlight; only used by the Meili strategy. */
  meiliHighlight?: string[];
}

export interface ShopSearchResult {
  shops: Array<WithId<Shop> & { _rankingScore?: number; _formatted?: Record<string, unknown> }>;
  total: number;
  /** True when `total` counts a superset (open-now / activity post-filtering). */
  approximateTotal: boolean;
  strategy: ShopSearchStrategy;
  /** Exact shop when `q` is purely numeric and matches a display ID. */
  exactMatch: Shop | null;
}

const OVERFETCH_FACTOR = 3;

// ── Activity post-filter (Redis-derived) ────────────────────────────────────

const matchesActivity = (
  activity: NonNullable<ShopFilterState['activity']>,
  attendance: ShopAttendanceResult | undefined
): boolean => {
  const total = attendance?.total ?? 0;
  if (activity.attendance?.min !== undefined && total < activity.attendance.min) return false;
  if (activity.attendance?.max !== undefined && total > activity.attendance.max) return false;
  if (activity.gameAttendance) {
    for (const requirement of activity.gameAttendance) {
      const perGame = (attendance?.games ?? [])
        .filter((game) => requirement.titleIds.includes(game.titleId))
        .reduce((sum, game) => sum + game.total, 0);
      if (requirement.min !== undefined && perGame < requirement.min) return false;
      if (requirement.max !== undefined && perGame > requirement.max) return false;
    }
  }
  return true;
};

// ── Sorting ─────────────────────────────────────────────────────────────────

const buildStatsSort = (sort: ShopSearchSort): Record<string, 1 | -1> => {
  switch (sort) {
    case 'name_desc':
      return { name: -1, id: 1 };
    case 'machines_desc':
      return { 'stats.machineCount': -1, id: 1 };
    case 'machines_asc':
      return { 'stats.machineCount': 1, id: 1 };
    case 'titles_desc':
      return { 'stats.distinctTitleCount': -1, id: 1 };
    case 'attendance_desc':
      return { 'stats.currentAttendance': -1, id: 1 };
    case 'id_asc':
      return { id: 1 };
    case 'id_desc':
      return { id: -1 };
    case 'updated_desc':
      return { updatedAt: -1, id: 1 };
    case 'created_desc':
      return { createdAt: -1, id: 1 };
    default:
      return { name: 1, id: 1 };
  }
};

const SORTS_NEEDING_PIPELINE: ShopSearchSort[] = ['machines_desc', 'machines_asc', 'titles_desc'];

// ── Orchestration ───────────────────────────────────────────────────────────

export const queryShops = async (params: ShopSearchParams): Promise<ShopSearchResult> => {
  const { filter, session } = params;
  const q = (params.q ?? '').trim();
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.max(1, params.limit ?? 48);
  const skip = (page - 1) * limit;

  let strategy = describeShopSearchStrategy(filter, q);
  const collection = mongo.db().collection<Shop>('shops');

  // Exact shop pin for purely numeric queries ("1234" → shop #1234).
  const numericId = /^\d+$/.test(q) ? Number.parseInt(q, 10) : null;
  const exactMatch = numericId !== null ? await collection.findOne({ id: numericId }) : null;

  const postFiltering = needsPostFilter(filter);
  const approximateTotal = postFiltering;

  if (strategy === 'meili') {
    const meiliFilter = buildShopMeiliFilter(filter);
    if (meiliFilter !== null) {
      const sort = params.sort ?? 'relevance';
      try {
        const searchResult = await meili.index<Shop>('shops').search(q, {
          ...(meiliFilter ? { filter: meiliFilter } : {}),
          ...(sort !== 'relevance' && MEILI_SORTS[sort] ? { sort: [MEILI_SORTS[sort]] } : {}),
          limit,
          offset: skip,
          ...(params.meiliHighlight
            ? {
                attributesToHighlight: params.meiliHighlight,
                highlightPreTag: '<span class="text-highlight">',
                highlightPostTag: '</span>'
              }
            : {}),
          showRankingScore: true
        });
        return {
          shops: searchResult.hits as ShopSearchResult['shops'],
          total: searchResult.estimatedTotalHits ?? 0,
          approximateTotal: false,
          strategy,
          exactMatch
        };
      } catch (err) {
        // Meilisearch unavailable: degrade to the exact Mongo text path
        // instead of failing the page (relevance/highlighting are lost).
        console.error('[shop-search] Meilisearch failed, falling back to Mongo text:', err);
      }
    }
    // Filter not index-expressible after all (pathological token explosion) —
    // fall back to the Mongo text path.
    strategy = 'mongo-text';
  }

  // Resolve the effective sort. Distance sorting requires a geo anchor;
  // relevance on a Mongo path degrades to name order.
  const requestedSort: ShopSearchSort = params.sort ?? (q ? 'relevance' : 'name_asc');
  const sort: ShopSearchSort =
    (requestedSort === 'distance' && !filter.geo) || requestedSort === 'relevance'
      ? 'name_asc'
      : requestedSort;

  // Post-filtered pages over-fetch so the exact per-shop checks still fill
  // the page in most cases.
  const fetchLimit = postFiltering ? limit * OVERFETCH_FACTOR : limit;
  const fetchSkip = postFiltering ? (page - 1) * fetchLimit : skip;
  const collation = { locale: 'zh@collation=gb2312han' };

  let fetched: WithId<Shop>[];

  // One predicate shared by every Mongo path: the filter minus the geo radius,
  // plus the free-text query when one was typed. Building it once keeps the
  // `find`, the `$match` stage, and the `$geoNear.query` from drifting apart.
  const mongoPredicate = buildShopMongoPredicate(filter, q);

  if (filter.geo) {
    // Geo-constrained: `$geoNear` restricts by radius and orders by distance;
    // an explicit non-distance sort re-orders afterwards.
    const pipeline: Record<string, unknown>[] = [
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [filter.geo.lng, filter.geo.lat] },
          key: 'location',
          distanceField: '_distance',
          maxDistance: filter.geo.radiusKm * 1000,
          spherical: true,
          query: mongoPredicate as Record<string, unknown>
        }
      },
      ...(sort !== 'distance' ? [{ $sort: buildStatsSort(sort) }] : []),
      { $skip: fetchSkip },
      { $limit: fetchLimit }
    ];
    fetched = (await collection.aggregate(pipeline, { collation }).toArray()) as WithId<Shop>[];
  } else if (SORTS_NEEDING_PIPELINE.includes(sort)) {
    // Sorting by computed per-shop counts: project them, sort, and strip.
    const pipeline: Record<string, unknown>[] = [
      { $match: mongoPredicate },
      {
        $addFields: {
          _sortCount:
            sort === 'titles_desc'
              ? {
                  $size: {
                    $setUnion: [{ $map: { input: '$games', as: 'game', in: '$$game.titleId' } }, []]
                  }
                }
              : { $sum: '$games.quantity' }
        }
      },
      { $sort: { _sortCount: sort.endsWith('_desc') ? -1 : 1, id: 1 } },
      { $skip: fetchSkip },
      { $limit: fetchLimit },
      { $unset: '_sortCount' }
    ];
    fetched = (await collection.aggregate(pipeline, { collation }).toArray()) as WithId<Shop>[];
  } else {
    fetched = await collection
      .find(mongoPredicate)
      .sort(buildStatsSort(sort))
      .collation(collation)
      .skip(fetchSkip)
      .limit(fetchLimit)
      .toArray();
  }

  // Exact post-filters over the fetched page.
  if (filter.hours?.openNow) {
    const now = new Date();
    fetched = fetched.filter((shop) => isShopOpenAt(shop, now));
  }
  if (filter.activity) {
    const attendanceMap = await getShopsAttendanceData(
      fetched.map((shop) => shop.id),
      { fetchRegistered: true, fetchReported: true, session }
    );
    fetched = fetched.filter((shop) =>
      matchesActivity(
        filter.activity as NonNullable<ShopFilterState['activity']>,
        attendanceMap.get(String(shop.id))
      )
    );
  }

  // The total must never be wider than the page: it applies the same predicate
  // as the fetch *plus* the geo radius, which `$geoNear` cannot express as a
  // plain query filter.
  const total = await collection.countDocuments(buildShopMongoCountFilter(filter, q));

  return {
    shops: fetched.slice(0, limit),
    total,
    approximateTotal,
    strategy,
    exactMatch
  };
};
