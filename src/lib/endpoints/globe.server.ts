import mongo from '$lib/db/index.server';
import type { Filter } from 'mongodb';
import { getAllShopsAttendanceData } from '$lib/endpoints/attendance.server';
import { GAME_TITLES } from '$lib/constants';
import type { GlobeShop, GlobeShopGameSummary, Shop } from '$lib/types';
import { getShopOpeningHours } from '$lib/utils';
import { toShopApiAddress } from '$lib/utils/region.server';
import {
  buildShopGeoFilter,
  buildShopMongoFilter,
  combineMongoFilters
} from '$lib/utils/shops/filter-query.server';
import { isShopOpenAt } from '$lib/utils/shops/derived';
import type { ShopFilterState } from '$lib/schemas/shop-filter';

export type GlobeAttendanceTotals = Array<{ gameId: number; total: number }>;
export type GlobeAttendanceMap = Map<string, GlobeAttendanceTotals>;

// ── Attendance cache ────────────────────────────────────────────────────────
// /api/globe/shops receives many batch requests per refresh cycle (e.g. 140+
// batches for 7,000+ shops). Without caching, each batch performs
// Redis KEYS nearcade:attend:* + KEYS nearcade:attend-report:* — two full O(N)
// scans. A short TTL cache collapses those into a single scan per cycle.
let cachedAttendance: { data: GlobeAttendanceMap; expiresAt: number } | null = null;
const ATTENDANCE_CACHE_TTL_MS = 15_000;

const loadGlobeAttendanceCached = async (): Promise<GlobeAttendanceMap> => {
  const now = Date.now();
  if (cachedAttendance && now < cachedAttendance.expiresAt) {
    return cachedAttendance.data;
  }
  const data = await getAllShopsAttendanceData();
  cachedAttendance = { data, expiresAt: now + ATTENDANCE_CACHE_TTL_MS };
  return data;
};

type RawGlobeShopGame = Pick<Shop['games'][number], 'gameId' | 'titleId' | 'name' | 'quantity'>;

type RawGlobeShop = {
  id: Shop['id'];
  name: Shop['name'];
  address: {
    general: Shop['address']['general'];
    region?: string[];
  };
  location: Shop['location'];
  openingHours: Shop['openingHours'];
  games: RawGlobeShopGame[];
  isClosed?: Shop['isClosed'];
};

const GAME_SEATS_BY_TITLE_ID = new Map<number, number>(
  GAME_TITLES.map((game) => [game.id, game.seats || 1])
);
const globeShopProjection = {
  _id: 0,
  name: 1,
  'address.general': 1,
  'address.region': 1,
  location: 1,
  openingHours: 1,
  'games.gameId': 1,
  'games.titleId': 1,
  'games.name': 1,
  'games.quantity': 1,
  id: 1,
  isClosed: 1
} as const;

const aggregateGlobeGames = (games: RawGlobeShopGame[]): GlobeShopGameSummary[] => {
  const gameMap = new Map<number, GlobeShopGameSummary>();

  for (const game of games) {
    const existing = gameMap.get(game.titleId);
    if (existing) {
      existing.quantity += game.quantity;
      continue;
    }

    gameMap.set(game.titleId, {
      titleId: game.titleId,
      name: game.name,
      quantity: game.quantity
    });
  }

  return Array.from(gameMap.values());
};

const getGlobeShopDensity = (shop: RawGlobeShop, attendances: GlobeAttendanceTotals): number => {
  if (shop.isClosed) return 0;

  const openingHoursParsed = getShopOpeningHours(shop);
  const now = new Date();

  if (now < openingHoursParsed.openTolerated || now > openingHoursParsed.closeTolerated) {
    return 0;
  }

  const densityByTitleId = new Map<number, { attendance: number; positions: number }>();
  const titleIdByGameId = new Map<number, number>();

  for (const game of shop.games) {
    titleIdByGameId.set(game.gameId, game.titleId);
    const entry = densityByTitleId.get(game.titleId) ?? { attendance: 0, positions: 0 };
    entry.positions += game.quantity * (GAME_SEATS_BY_TITLE_ID.get(game.titleId) ?? 1);
    densityByTitleId.set(game.titleId, entry);
  }

  for (const attendance of attendances) {
    const titleId = titleIdByGameId.get(attendance.gameId);
    if (titleId === undefined) continue;
    const entry = densityByTitleId.get(titleId);
    if (!entry) continue;
    entry.attendance += attendance.total;
  }

  let density = 0;
  for (const { attendance, positions } of densityByTitleId.values()) {
    if (positions <= 0) continue;
    density = Math.max(density, attendance / positions);
  }

  if (!isFinite(density) || isNaN(density)) return 0;

  switch (true) {
    case density < 0.1:
      return 1;
    case density < 1:
      return 2;
    case density < 2:
      return 3;
    default:
      return 4;
  }
};

/**
 * Everything except the address: the localized region chain is resolved once,
 * in {@link toGlobeShopWithRegion}, so a raw shop never carries region names.
 */
const toGlobeShop = (
  shop: RawGlobeShop,
  attendances: GlobeAttendanceTotals
): Omit<GlobeShop, 'address'> => ({
  id: shop.id,
  name: shop.name,
  openingHours: shop.openingHours,
  location: shop.location,
  aggregatedGames: aggregateGlobeGames(shop.games),
  currentAttendance: attendances.reduce((sum, attendance) => sum + attendance.total, 0),
  density: getGlobeShopDensity(shop, attendances),
  ...(shop.isClosed ? { isClosed: true } : {})
});

export type GlobeShopFilters = {
  /** Legacy URL param constraints (still accepted for old shared links). */
  titleIds?: number[];
  /**
   * Structured filter state (`f` URL param), translated by the shared engine.
   * The single source of truth for what the globe shows — including the region
   * selected by clicking a shop, which occupies a `regions` slot like any other
   * filter dimension rather than a constraint of its own.
   */
  filter?: ShopFilterState;
};

const getGlobeShopFilter = ({ titleIds = [], filter }: GlobeShopFilters): Filter<Shop> =>
  combineMongoFilters(
    titleIds.length > 0
      ? ({
          games: { $all: titleIds.map((titleId) => ({ $elemMatch: { titleId } })) }
        } as Filter<Shop>)
      : null,
    filter ? (buildShopMongoFilter(filter) as Filter<Shop>) : null
  );

/**
 * The full predicate for every globe query that is *not* the `$geoNear`
 * pipeline: the sidebar total, the by-name path and the marker set.
 *
 * `getGlobeShopFilter` deliberately omits geo (the `$geoNear` stage applies it
 * while fetching), so it has to be added back here — otherwise "near me"
 * silently widens the reported count, the by-name page and the map markers to
 * every shop on earth.
 */
const getGlobeShopQuery = (filters: GlobeShopFilters): Filter<Shop> =>
  combineMongoFilters(
    getGlobeShopFilter(filters),
    filters.filter?.geo ? buildShopGeoFilter(filters.filter) : null
  );

/** Predicates no index can answer — applied exactly over fetched results. */
const needsGlobePostFilter = (filters: GlobeShopFilters): boolean =>
  !!filters.filter?.hours?.openNow || !!filters.filter?.activity;

const matchesGlobeActivity = (
  activity: NonNullable<ShopFilterState['activity']>,
  shop: RawGlobeShop,
  attendances: GlobeAttendanceTotals
): boolean => {
  const titleIdByGameId = new Map(shop.games.map((game) => [game.gameId, game.titleId]));
  const total = attendances.reduce((sum, attendance) => sum + attendance.total, 0);
  if (activity.attendance?.min !== undefined && total < activity.attendance.min) return false;
  if (activity.attendance?.max !== undefined && total > activity.attendance.max) return false;
  if (activity.gameAttendance) {
    for (const requirement of activity.gameAttendance) {
      const perGame = attendances
        .filter((attendance) => {
          const titleId = titleIdByGameId.get(attendance.gameId);
          return titleId !== undefined && requirement.titleIds.includes(titleId);
        })
        .reduce((sum, attendance) => sum + attendance.total, 0);
      if (requirement.min !== undefined && perGame < requirement.min) return false;
      if (requirement.max !== undefined && perGame > requirement.max) return false;
    }
  }
  return true;
};

/** Exact per-shop post-filters (open-now, activity) for fetched globe shops. */
const applyGlobePostFilters = (
  shops: RawGlobeShop[],
  filters: GlobeShopFilters,
  attendanceByShop: GlobeAttendanceMap
): RawGlobeShop[] => {
  let result = shops;
  if (filters.filter?.hours?.openNow) {
    const now = new Date();
    result = result.filter((shop) => isShopOpenAt(shop, now));
  }
  if (filters.filter?.activity) {
    const activity = filters.filter.activity;
    result = result.filter((shop) =>
      matchesGlobeActivity(activity, shop, attendanceByShop.get(`${shop.id}`) ?? [])
    );
  }
  return result;
};

const loadRawGlobeShops = (filters: GlobeShopFilters = {}) => {
  const query = getGlobeShopQuery(filters);

  return mongo
    .db()
    .collection<Shop>('shops')
    .find(query)
    .project(globeShopProjection)
    .toArray() as Promise<RawGlobeShop[]>;
};

/**
 * Attach the localized region chain (IDs + the request's locale) to a raw
 * globe shop. `address.general` is derived from the very same names, so the
 * marker popups can never disagree with the region filter.
 */
const toGlobeShopWithRegion = async (
  raw: RawGlobeShop,
  attendances: GlobeAttendanceTotals
): Promise<GlobeShop> => {
  const address = await toShopApiAddress({
    general: raw.address.general,
    region: raw.address.region
  });
  return {
    ...toGlobeShop(raw, attendances),
    address: { general: address.general, region: address.region }
  };
};

export const loadGlobeShopsWithRegions = async (): Promise<GlobeShop[]> => {
  const [rawShops, attendance] = await Promise.all([
    loadRawGlobeShops(),
    loadGlobeAttendanceCached()
  ]);

  return Promise.all(
    rawShops.map((raw) => toGlobeShopWithRegion(raw, attendance.get(`${raw.id}`) ?? []))
  );
};

export const loadGlobeAttendance = (): Promise<GlobeAttendanceMap> => loadGlobeAttendanceCached();

export const loadGlobeDataResponse = async (): Promise<{
  shops: GlobeShop[];
}> => {
  return {
    shops: await loadGlobeShopsWithRegions()
  };
};

// ---- Lightweight markers endpoint ( Optimization 1 ) ----

export type GlobeMarker = {
  id: number;
  name: string;
  lng: number;
  lat: number;
  density: number;
};

/**
 * Returns minimal marker data for all shops matching the filters: id, name,
 * coordinates, density. Time-dependent and activity predicates are applied
 * exactly here (the whole matching set is loaded anyway).
 */
export const loadGlobeMarkers = async (filters: GlobeShopFilters = {}): Promise<GlobeMarker[]> => {
  const [allShops, attendance] = await Promise.all([
    loadRawGlobeShops(filters),
    loadGlobeAttendanceCached()
  ]);
  const shops = applyGlobePostFilters(allShops, filters, attendance);

  return shops.map((shop) => ({
    id: shop.id,
    name: shop.name,
    lng: shop.location.coordinates[0],
    lat: shop.location.coordinates[1],
    density: getGlobeShopDensity(shop, attendance.get(`${shop.id}`) ?? [])
  }));
};

const hydrateGlobeShops = async (rawShops: RawGlobeShop[]): Promise<GlobeShop[]> => {
  const attendance = await loadGlobeAttendanceCached();
  return Promise.all(
    rawShops.map((raw) => toGlobeShopWithRegion(raw, attendance.get(`${raw.id}`) ?? []))
  );
};

/**
 * Loads full GlobeShop details for a specific set of shop IDs.
 * Used by the client to fetch details on demand (sidebar, hover, pin).
 */
export const loadGlobeShopsByIds = async (ids: number[]): Promise<GlobeShop[]> => {
  if (ids.length === 0) return [];

  const rawShops = (await mongo
    .db()
    .collection<Shop>('shops')
    .find({ id: { $in: ids } })
    .project(globeShopProjection)
    .toArray()) as RawGlobeShop[];

  return hydrateGlobeShops(rawShops);
};

const GLOBE_SHOPS_PAGE_SIZE = 6;
/** Over-fetch factor for pages that need exact post-filtering. */
const GLOBE_POSTFILTER_FACTOR = 3;

export const loadGlobeShopsByDistance = async (
  longitude: number,
  latitude: number,
  offset: number,
  filters: GlobeShopFilters = {}
): Promise<{
  shops: GlobeShop[];
  hasMore: boolean;
  totalCount: number;
  approximateTotal: boolean;
}> => {
  const filter = getGlobeShopFilter(filters);
  // The panel's geo anchor (point + radius) wins over the sidebar origin when
  // present, so the location constraint and the distance order agree.
  const anchor = filters.filter?.geo
    ? {
        lng: filters.filter.geo.lng,
        lat: filters.filter.geo.lat,
        maxDistanceMeters: filters.filter.geo.radiusKm * 1000
      }
    : { lng: longitude, lat: latitude, maxDistanceMeters: undefined };
  const postFiltering = needsGlobePostFilter(filters);
  const fetchLimit = GLOBE_SHOPS_PAGE_SIZE * (postFiltering ? GLOBE_POSTFILTER_FACTOR : 1);
  // The page comes from `$geoNear` (which applies the radius as `maxDistance`),
  // but a pipeline stage cannot be reused by `countDocuments`, so the same radius
  // is added here as `$geoWithin`/`$centerSphere` — the identical great-circle
  // measure on the same 2dsphere index, so the count can never outgrow the page.
  const countQuery = getGlobeShopQuery(filters);
  const [allRaw, totalCount] = await Promise.all([
    mongo
      .db()
      .collection<Shop>('shops')
      .aggregate([
        {
          $geoNear: {
            near: { type: 'Point', coordinates: [anchor.lng, anchor.lat] },
            key: 'location',
            distanceField: '_globeDistance',
            ...(anchor.maxDistanceMeters !== undefined
              ? { maxDistance: anchor.maxDistanceMeters }
              : {}),
            spherical: true,
            ...(Object.keys(filter).length > 0 ? { query: filter } : {})
          }
        },
        { $skip: postFiltering ? offset * GLOBE_POSTFILTER_FACTOR : offset },
        { $limit: fetchLimit + 1 },
        { $project: globeShopProjection }
      ])
      .toArray() as Promise<RawGlobeShop[]>,
    mongo.db().collection<Shop>('shops').countDocuments(countQuery)
  ]);

  const filtered = applyGlobePostFilters(allRaw, filters, await loadGlobeAttendanceCached());
  const hasMore = filtered.length > GLOBE_SHOPS_PAGE_SIZE;
  return {
    shops: await hydrateGlobeShops(filtered.slice(0, GLOBE_SHOPS_PAGE_SIZE)),
    hasMore,
    totalCount,
    approximateTotal: postFiltering
  };
};

export const loadGlobeShopsByName = async (
  offset: number,
  filters: GlobeShopFilters = {}
): Promise<{
  shops: GlobeShop[];
  hasMore: boolean;
  totalCount: number;
  approximateTotal: boolean;
}> => {
  const filter = getGlobeShopQuery(filters);
  const postFiltering = needsGlobePostFilter(filters);
  const fetchLimit = GLOBE_SHOPS_PAGE_SIZE * (postFiltering ? GLOBE_POSTFILTER_FACTOR : 1);
  const [allRaw, totalCount] = await Promise.all([
    mongo
      .db()
      .collection<Shop>('shops')
      .find(filter)
      .sort({ name: 1, id: 1 })
      .skip(postFiltering ? offset * GLOBE_POSTFILTER_FACTOR : offset)
      .limit(fetchLimit + 1)
      .project(globeShopProjection)
      .toArray() as Promise<RawGlobeShop[]>,
    mongo.db().collection<Shop>('shops').countDocuments(filter)
  ]);

  const filtered = applyGlobePostFilters(allRaw, filters, await loadGlobeAttendanceCached());
  const hasMore = filtered.length > GLOBE_SHOPS_PAGE_SIZE;
  return {
    shops: await hydrateGlobeShops(filtered.slice(0, GLOBE_SHOPS_PAGE_SIZE)),
    hasMore,
    totalCount,
    approximateTotal: postFiltering
  };
};
