import mongo from '$lib/db/index.server';
import { getAllShopsAttendanceData } from '$lib/endpoints/attendance.server';
import { GAME_TITLES } from '$lib/constants';
import type { GlobeShop, GlobeShopGameSummary, Shop } from '$lib/types';
import { getShopOpeningHours } from '$lib/utils';
import { expandRegionHierarchyWithNames } from '$lib/regions/utils.server';
import { localizeAddressGeneral } from '$lib/utils/region.server';

export type GlobeAttendanceTotals = Array<{ gameId: number; total: number }>;
export type GlobeAttendanceMap = Map<string, GlobeAttendanceTotals>;

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

const loadRawGlobeShops = () =>
  mongo.db().collection<Shop>('shops').find({}).project(globeShopProjection).toArray() as Promise<
    RawGlobeShop[]
  >;

export const loadGlobeShops = async (): Promise<GlobeShop[]> => {
  const [shops, attendance] = await Promise.all([loadRawGlobeShops(), loadGlobeAttendance()]);

  return shops.map((shop) => toGlobeShop(shop, attendance.get(`${shop.id}`) ?? []));
};

export const loadGlobeShopsWithRegions = async (): Promise<GlobeShop[]> => {
  const [rawShops, attendance] = await Promise.all([loadRawGlobeShops(), loadGlobeAttendance()]);

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

export const loadGlobeAttendance = (): Promise<GlobeAttendanceMap> => getAllShopsAttendanceData();

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
export const loadGlobeMarkers = async (): Promise<GlobeMarker[]> => {
  const [shops, attendance] = await Promise.all([loadRawGlobeShops(), loadGlobeAttendance()]);

  return shops.map((shop) => ({
    id: shop.id,
    name: shop.name,
    lng: shop.location.coordinates[0],
    lat: shop.location.coordinates[1],
    density: getGlobeShopDensity(shop, attendance.get(`${shop.id}`) ?? [])
  }));
};

/**
 * Loads full GlobeShop details for a specific set of shop IDs.
 * Used by the client to fetch details on demand (sidebar, hover, pin).
 */
export const loadGlobeShopsByIds = async (ids: number[]): Promise<GlobeShop[]> => {
  if (ids.length === 0) return [];

  const [rawShops, attendance] = await Promise.all([
    mongo
      .db()
      .collection<Shop>('shops')
      .find({ id: { $in: ids } })
      .project(globeShopProjection)
      .toArray() as Promise<RawGlobeShop[]>,
    loadGlobeAttendance()
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
