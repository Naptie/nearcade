import mongo from '$lib/db/index.server';
import type { Filter } from 'mongodb';
import { getAllShopsAttendanceData } from '$lib/endpoints/attendance.server';
import { GAME_TITLES } from '$lib/constants';
import type { GlobeShop, GlobeShopGameSummary, Shop } from '$lib/types';
import { getShopOpeningHours } from '$lib/utils';
import { expandRegionHierarchyWithNames } from '$lib/regions/utils.server';
import { localizeAddressGeneral } from '$lib/utils/region.server';

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
  id: 1
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

const toGlobeShop = (shop: RawGlobeShop, attendances: GlobeAttendanceTotals): GlobeShop => ({
  id: shop.id,
  name: shop.name,
  address: {
    general: shop.address.general,
    region: shop.address.region
  },
  openingHours: shop.openingHours,
  location: shop.location,
  aggregatedGames: aggregateGlobeGames(shop.games),
  currentAttendance: attendances.reduce((sum, attendance) => sum + attendance.total, 0),
  density: getGlobeShopDensity(shop, attendances)
});

type GlobeMarkerFilters = {
  regionId?: string;
  titleIds?: number[];
};

const loadRawGlobeShops = (filters: GlobeMarkerFilters = {}) => {
  const { regionId, titleIds = [] } = filters;
  const query: Filter<Shop> = {
    ...(regionId ? { 'address.region': regionId } : {}),
    ...(titleIds.length > 0
      ? { games: { $all: titleIds.map((titleId) => ({ $elemMatch: { titleId } })) } }
      : {})
  };

  return mongo
    .db()
    .collection<Shop>('shops')
    .find(query)
    .project(globeShopProjection)
    .toArray() as Promise<RawGlobeShop[]>;
};

export const loadGlobeShops = async (): Promise<GlobeShop[]> => {
  const [shops, attendance] = await Promise.all([loadRawGlobeShops(), loadGlobeAttendanceCached()]);

  return shops.map((shop) => toGlobeShop(shop, attendance.get(`${shop.id}`) ?? []));
};

export const loadGlobeShopsWithRegions = async (): Promise<GlobeShop[]> => {
  const [rawShops, attendance] = await Promise.all([
    loadRawGlobeShops(),
    loadGlobeAttendanceCached()
  ]);

  const result: GlobeShop[] = [];
  for (const raw of rawShops) {
    const region = raw.address.region;
    const expandedRegion = region?.length
      ? await expandRegionHierarchyWithNames(region[region.length - 1]).catch(() => [])
      : undefined;
    const addressWithRegion = {
      general: raw.address.general,
      region: expandedRegion as GlobeShop['address']['region']
    };
    result.push({
      ...toGlobeShop(raw, attendance.get(`${raw.id}`) ?? []),
      address: {
        general: localizeAddressGeneral(addressWithRegion),
        region: expandedRegion as GlobeShop['address']['region']
      }
    });
  }
  return result;
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
 * Returns minimal marker data for all shops: id, name, coordinates, density.
 * This is ~95% smaller than the full globe data response.
 */
export const loadGlobeMarkers = async (
  filters: GlobeMarkerFilters = {}
): Promise<GlobeMarker[]> => {
  const [shops, attendance] = await Promise.all([
    loadRawGlobeShops(filters),
    loadGlobeAttendanceCached()
  ]);

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
  const result: GlobeShop[] = [];
  for (const raw of rawShops) {
    const region = raw.address.region;
    const expandedRegion = region?.length
      ? await expandRegionHierarchyWithNames(region[region.length - 1]).catch(() => [])
      : undefined;
    const addressWithRegion = {
      general: raw.address.general,
      region: expandedRegion as GlobeShop['address']['region']
    };
    result.push({
      ...toGlobeShop(raw, attendance.get(`${raw.id}`) ?? []),
      address: {
        general: localizeAddressGeneral(addressWithRegion),
        region: expandedRegion as GlobeShop['address']['region']
      }
    });
  }
  return result;
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

export const GLOBE_SHOPS_PAGE_SIZE = 6;

export const loadGlobeShopsByDistance = async (
  longitude: number,
  latitude: number,
  offset: number,
  regionId?: string
): Promise<{ shops: GlobeShop[]; hasMore: boolean }> => {
  const rawShops = (await mongo
    .db()
    .collection<Shop>('shops')
    .aggregate([
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [longitude, latitude] },
          key: 'location',
          distanceField: '_globeDistance',
          ...(regionId ? { query: { 'address.region': regionId } } : {})
        }
      },
      { $skip: offset },
      { $limit: GLOBE_SHOPS_PAGE_SIZE + 1 },
      { $project: globeShopProjection }
    ])
    .toArray()) as RawGlobeShop[];

  const hasMore = rawShops.length > GLOBE_SHOPS_PAGE_SIZE;
  return {
    shops: await hydrateGlobeShops(rawShops.slice(0, GLOBE_SHOPS_PAGE_SIZE)),
    hasMore
  };
};

export const loadGlobeShopsByName = async (
  offset: number,
  regionId?: string
): Promise<{ shops: GlobeShop[]; hasMore: boolean }> => {
  const rawShops = (await mongo
    .db()
    .collection<Shop>('shops')
    .find(regionId ? { 'address.region': regionId } : {})
    .sort({ name: 1, id: 1 })
    .skip(offset)
    .limit(GLOBE_SHOPS_PAGE_SIZE + 1)
    .project(globeShopProjection)
    .toArray()) as RawGlobeShop[];

  const hasMore = rawShops.length > GLOBE_SHOPS_PAGE_SIZE;
  return {
    shops: await hydrateGlobeShops(rawShops.slice(0, GLOBE_SHOPS_PAGE_SIZE)),
    hasMore
  };
};
