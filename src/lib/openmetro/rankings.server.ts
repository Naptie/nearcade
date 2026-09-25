/**
 * Metro station ranking rebuild (campus-parity per-radius metrics).
 *
 * Shared by `openmetro_sync` (end of the full sync) and the standalone
 * `metro_rankings` data-update task, which re-derives rankings from the
 * already-persisted metro_* collections + shops — no Open Metro API calls.
 */
import type { MongoClient } from 'mongodb';
import {
  GAME_TITLES,
  METRO_ACCESS_MAX_KM,
  METRO_RANKING_RADIUS_OPTIONS,
  metroRankingSortKey
} from '$lib/constants';
import type { MetroStationRanking, ShopMetro } from '$lib/schemas/metro';
import type { RankingMetrics } from '$lib/schemas/rankings';
import { calculateDistanceKm, snapToStation } from './graph.server';
import type { MetroLineDoc, MetroNetworkDoc, MetroStationDoc } from './schemas';

const RANKINGS_CACHE_DURATION_MS = 24 * 60 * 60 * 1000;

export interface RankableShop {
  id: number;
  location?: { coordinates?: [number, number] | null } | null;
  games?: Array<{ titleId: number; quantity: number }> | null;
}

export interface MetroRankingStationGroup {
  station: MetroStationDoc;
  shops: RankableShop[];
}

export interface RebuildMetroRankingsInput {
  /** Operating stations only (out-of-service must never host a shop). */
  stations: MetroStationDoc[];
  lineDocs: MetroLineDoc[];
  shops: RankableShop[];
  /** When omitted, shops are re-snapped to `stations` to derive groups. */
  assigned?: Map<string, MetroRankingStationGroup>;
  /** Network list for metadata; loaded from `openmetro_networks` when omitted. */
  networks?: Array<Pick<MetroNetworkDoc, '_id' | 'name' | 'names'>>;
}

export interface RebuildMetroRankingsResult {
  rankingCount: number;
  assignedCount: number;
  unassignedCount: number;
  networkCount: number;
}

const getShopsWithinRadius = (
  shops: RankableShop[],
  stationLon: number,
  stationLat: number,
  radiusKm: number
): RankableShop[] =>
  shops.filter((shop) => {
    const [lng, lat] = shop.location?.coordinates ?? [];
    return (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      calculateDistanceKm(stationLat, stationLon, lat as number, lng as number) <= radiusKm
    );
  });

const countGameMachines = (shops: RankableShop[], titleId: number): number =>
  shops.reduce(
    (total, shop) => total + (shop.games?.find((game) => game.titleId === titleId)?.quantity || 0),
    0
  );

const calculateMetricsForRadius = (shops: RankableShop[], radiusKm: number): RankingMetrics => {
  const totalMachines = shops.reduce(
    (total, shop) =>
      total + (shop.games?.reduce((sum, game) => sum + (game.quantity || 0), 0) ?? 0),
    0
  );
  return {
    radius: radiusKm,
    shopCount: shops.length,
    totalMachines,
    // Straight-line radius areas are exact circles (unlike region polygons),
    // so density is always defined — matching campus behaviour for campuses.
    areaDensity: totalMachines / (Math.PI * radiusKm * radiusKm),
    machinesPerCapita: null,
    gameSpecificMachines: GAME_TITLES.map((game) => ({
      name: game.key,
      quantity: countGameMachines(shops, game.id)
    }))
  };
};

export const createStationLineBadges =
  (lineDocsById: Map<string, MetroLineDoc>) =>
  (station: MetroStationDoc): ShopMetro['lines'] =>
    station.lineIds.flatMap((lineId) => {
      const line = lineDocsById.get(lineId);
      return line
        ? [
            {
              id: line._id,
              name: line.name,
              names: line.names,
              color: line.color,
              shortName: line.shortName
            }
          ]
        : [];
    });

const deriveAssigned = (
  stations: MetroStationDoc[],
  shops: RankableShop[]
): Map<string, MetroRankingStationGroup> => {
  const assigned = new Map<string, MetroRankingStationGroup>();
  for (const shop of shops) {
    const [lng, lat] = shop.location?.coordinates ?? [];
    const snap =
      Number.isFinite(lat) && Number.isFinite(lng)
        ? snapToStation(stations, lat as number, lng as number, METRO_ACCESS_MAX_KM)
        : null;
    if (!snap) continue;
    const group = assigned.get(snap.station._id);
    if (group) {
      group.shops.push(shop);
    } else {
      assigned.set(snap.station._id, { station: snap.station, shops: [shop] });
    }
  }
  return assigned;
};

/**
 * Rebuild `metro_station_rankings` from local data. Safe to run without the
 * Open Metro API; used as Phase 4 of `openmetro_sync` and by the standalone
 * `metro_rankings` admin task.
 */
export const rebuildMetroRankings = async (
  client: MongoClient,
  options: {
    input?: RebuildMetroRankingsInput;
  } = {}
): Promise<RebuildMetroRankingsResult> => {
  const db = client.db();
  const rankingsCollection = db.collection('metro_station_rankings');

  let stations: MetroStationDoc[];
  let lineDocs: MetroLineDoc[];
  let shops: RankableShop[];
  let assigned: Map<string, MetroRankingStationGroup>;
  let networks: Array<Pick<MetroNetworkDoc, '_id' | 'name' | 'names'>>;

  if (options.input) {
    stations = options.input.stations;
    lineDocs = options.input.lineDocs;
    shops = options.input.shops;
    assigned = options.input.assigned ?? deriveAssigned(stations, shops);
    networks =
      options.input.networks ??
      (await db
        .collection<MetroNetworkDoc>('openmetro_networks')
        .find({}, { projection: { name: 1, names: 1 } })
        .toArray());
  } else {
    [stations, lineDocs, shops, networks] = await Promise.all([
      db.collection<MetroStationDoc>('metro_stations').find({ status: 'operating' }).toArray(),
      db.collection<MetroLineDoc>('metro_lines').find({}).toArray(),
      db
        .collection<RankableShop>('shops')
        .find({}, { projection: { id: 1, location: 1, games: 1 } })
        .toArray(),
      db
        .collection<MetroNetworkDoc>('openmetro_networks')
        .find({}, { projection: { name: 1, names: 1 } })
        .toArray()
    ]);
    assigned = deriveAssigned(stations, shops);
  }

  const lineDocsById = new Map(lineDocs.map((line) => [line._id, line] as const));
  const stationLineBadges = createStationLineBadges(lineDocsById);

  const now = new Date();
  const existingMetadata = (await rankingsCollection.findOne({ _id: 'metadata' } as never)) as {
    createdAt?: Date;
    networks?: Array<{
      id: string;
      name: string;
      names?: { zh: string; en: string };
      stationCount: number;
    }>;
  } | null;

  // Keep the last published network list available while rebuilding or on failure.
  const metadataNetworks =
    existingMetadata?.networks ??
    networks.map((network) => ({
      id: network._id,
      name: network.name,
      names: network.names,
      stationCount: 0
    }));

  await rankingsCollection.replaceOne(
    { _id: 'metadata' } as never,
    {
      _id: 'metadata',
      createdAt: existingMetadata?.createdAt ?? now,
      expiresAt: new Date(Date.now() - 1),
      totalCount: 0,
      isCalculating: true,
      calculationStarted: now,
      networks: metadataNetworks
    } as never,
    { upsert: true }
  );

  try {
    await rankingsCollection.deleteMany({ _id: { $ne: 'metadata' } } as never);

    // Campus-parity model: each station carries per-radius metrics over ALL
    // shops by straight-line distance. The smallest radius equals the snapping
    // cutoff's inner bucket; larger radii are caches from the same projection.
    const sortCriteria = ['shops', 'machines', ...GAME_TITLES.map((game) => game.key)] as const;
    const rankings: MetroStationRanking[] = [];

    for (const [stationId, group] of assigned) {
      const { station } = group;
      rankings.push({
        id: `${station.networkId}:${stationId}`,
        _id: `${station.networkId}:${stationId}`,
        networkId: station.networkId,
        stationId,
        name: station.name,
        names: station.names,
        lines: stationLineBadges(station),
        location: { lon: station.lon, lat: station.lat },
        rankings: METRO_RANKING_RADIUS_OPTIONS.map((radius) =>
          calculateMetricsForRadius(
            getShopsWithinRadius(shops, station.lon, station.lat, radius),
            radius
          )
        ),
        rankOrder: {}
      });
    }

    for (const sortBy of sortCriteria) {
      for (const radius of METRO_RANKING_RADIUS_OPTIONS) {
        // Dot-safe key: Mongo paths split on '.', so decimal radii are encoded
        // in centimetres (see metroRankingSortKey).
        const sortKey = metroRankingSortKey(sortBy, radius);
        const sorted = [...rankings].sort((left, right) => {
          const leftMetrics = left.rankings.find((entry) => entry.radius === radius);
          const rightMetrics = right.rankings.find((entry) => entry.radius === radius);
          if (!leftMetrics || !rightMetrics) return 0;
          let difference: number;
          switch (sortBy) {
            case 'shops':
              difference = rightMetrics.shopCount - leftMetrics.shopCount;
              break;
            case 'machines':
              difference = rightMetrics.totalMachines - leftMetrics.totalMachines;
              break;
            default: {
              const leftQuantity =
                leftMetrics.gameSpecificMachines.find((entry) => entry.name === sortBy)?.quantity ??
                0;
              const rightQuantity =
                rightMetrics.gameSpecificMachines.find((entry) => entry.name === sortBy)
                  ?.quantity ?? 0;
              difference = rightQuantity - leftQuantity;
            }
          }
          // Locale-independent ID order keeps tied ranks stable across shop read orders.
          return difference || (left._id < right._id ? -1 : left._id > right._id ? 1 : 0);
        });
        sorted.forEach((ranking, index) => {
          ranking.rankOrder[sortKey] = index + 1;
        });
      }
    }

    if (rankings.length > 0) {
      await rankingsCollection.insertMany(rankings as never[]);
    }

    await rankingsCollection.replaceOne(
      { _id: 'metadata' } as never,
      {
        _id: 'metadata',
        createdAt: now,
        expiresAt: new Date(Date.now() + RANKINGS_CACHE_DURATION_MS),
        totalCount: rankings.length,
        isCalculating: false,
        calculationStarted: undefined,
        networks: networks.map((network) => ({
          id: network._id,
          name: network.name,
          names: network.names,
          stationCount: rankings.filter((ranking) => ranking.networkId === network._id).length
        }))
      } as never,
      { upsert: true }
    );
  } catch (error) {
    await rankingsCollection.replaceOne(
      { _id: 'metadata' } as never,
      {
        _id: 'metadata',
        createdAt: existingMetadata?.createdAt ?? now,
        expiresAt: new Date(Date.now() - 1),
        totalCount: 0,
        isCalculating: false,
        calculationStarted: undefined,
        networks: metadataNetworks
      } as never,
      { upsert: true }
    );
    throw error;
  }

  const assignedCount = [...assigned.values()].reduce((sum, group) => sum + group.shops.length, 0);

  return {
    rankingCount: assigned.size,
    assignedCount,
    unassignedCount: shops.length - assignedCount,
    networkCount: networks.length
  };
};
