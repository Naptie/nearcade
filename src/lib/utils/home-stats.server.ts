/**
 * Home landing-page stats: aggregation over shops/regions/campuses/metro
 * stations plus its Redis cache (stale-while-revalidate). Shared by
 * `/api/home/stats` and the `home_stats` data-update task so admins can
 * rebuild the cache on demand — otherwise a shape change (e.g. a new
 * leaderboard block) would only reach clients after the cache TTL elapsed.
 */
import redis, { ensureConnected } from '$lib/db/redis.server';
import { getLocale } from '$lib/paraglide/runtime';
import type { Shop } from '$lib/types';
import {
  METRO_RANKING_RADIUS_OPTIONS,
  RANKING_RADIUS_OPTIONS,
  metroRankingSortKey
} from '$lib/constants';
import { expandRegionHierarchyWithNames } from '$lib/regions/utils.server';
import type { MongoClient } from 'mongodb';

export const pickLocalizedName = (name: Record<string, string>, fallback: string): string => {
  const locale = getLocale();
  return (
    name[locale] ?? name[locale.split('-')[0]] ?? name.en ?? Object.values(name)[0] ?? fallback
  );
};

export const HOME_STATS_CACHE_KEY = 'nearcade:home:stats';
// Data is considered fresh for 1 hour; the physical Redis key is kept much
// longer (1 day) so a stale payload can still be served instantly while a
// background recompute runs (stale-while-revalidate).
export const HOME_STATS_FRESH_TTL_SECONDS = 3600; // 1 hour
const PHYSICAL_TTL_SECONDS = 86400; // 1 day
const TOP_N = 10;

export interface HomeStatsResponse {
  totals: {
    shops: number;
    machines: number;
    users: number;
  };
  region: {
    [level: string]: {
      shops: { id: string; name: string; parentName: string | null; value: number }[];
      machines: { id: string; name: string; parentName: string | null; value: number }[];
    };
  };
  campus: {
    [radius: string]: {
      shops: { id: string; name: string; value: number }[];
      machines: { id: string; name: string; value: number }[];
    };
  };
  metro: {
    [radius: string]: {
      shops: {
        id: string;
        name: string;
        sublabel: string | null;
        lat: number;
        lon: number;
        value: number;
      }[];
      machines: {
        id: string;
        name: string;
        sublabel: string | null;
        lat: number;
        lon: number;
        value: number;
      }[];
    };
  };
}

export const computeHomeStats = async (client: MongoClient): Promise<HomeStatsResponse> => {
  const db = client.db();

  const [totalShops, totalUsers, machineAgg] = await Promise.all([
    db.collection('shops').countDocuments(),
    db.collection('users').countDocuments(),
    db
      .collection<Shop>('shops')
      .aggregate<{ total: number }>([
        { $unwind: '$games' },
        { $group: { _id: null, total: { $sum: '$games.quantity' } } }
      ])
      .toArray()
  ]);
  const totalMachines = machineAgg[0]?.total ?? 0;

  // ---- Region leaderboards (country / province / city x shops / machines) ----
  const region: HomeStatsResponse['region'] = {};
  const regionCollection = db.collection('region_rankings');

  for (const level of ['country', 'province', 'city']) {
    const entries = (await regionCollection
      .find({ _id: { $ne: 'metadata' }, level } as never)
      .project({
        _id: 0,
        id: 1,
        name: 1,
        shopCount: 1,
        totalMachines: 1,
        'rankOrder.shops': 1,
        'rankOrder.machines': 1
      })
      .toArray()) as unknown as {
      id: string;
      name: string;
      shopCount: number;
      totalMachines: number;
      rankOrder: Record<string, number>;
    }[];

    const decorate = async (
      sorted: { id: string; name: string; value: number }[]
    ): Promise<{ id: string; name: string; parentName: string | null; value: number }[]> => {
      return Promise.all(
        sorted.map(async (entry) => {
          let name = entry.name;
          let parentName: string | null = null;
          try {
            const chain = await expandRegionHierarchyWithNames(entry.id);
            if (chain.length > 0) {
              const last = chain[chain.length - 1];
              name = pickLocalizedName(last.name, entry.name);
              if (chain.length > 1) {
                const parent = chain[chain.length - 2];
                parentName = pickLocalizedName(parent.name, parent.id);
              }
            }
          } catch {
            // fall back to raw name
          }
          return { id: entry.id, name, parentName, value: entry.value };
        })
      );
    };

    const byShops = entries
      .filter((e) => typeof e.rankOrder?.shops === 'number')
      .sort((a, b) => a.rankOrder.shops - b.rankOrder.shops)
      .slice(0, TOP_N)
      .map((e) => ({ id: e.id, name: e.name, value: e.shopCount }));
    const byMachines = entries
      .filter((e) => typeof e.rankOrder?.machines === 'number')
      .sort((a, b) => a.rankOrder.machines - b.rankOrder.machines)
      .slice(0, TOP_N)
      .map((e) => ({ id: e.id, name: e.name, value: e.totalMachines }));

    region[level] = {
      shops: await decorate(byShops),
      machines: await decorate(byMachines)
    };
  }

  // ---- Campus leaderboards (2/5/10/30 km x shops / machines) ----
  const campus: HomeStatsResponse['campus'] = {};
  const campusCollection = db.collection('campus_rankings');

  const campusEntries = (await campusCollection
    .find({ _id: { $ne: 'metadata' } } as never)
    .project({ _id: 0, id: 1, fullName: 1, rankings: 1, rankOrder: 1 })
    .toArray()) as unknown as {
    id: string;
    fullName: string;
    rankings: { radius: number; shopCount: number; totalMachines: number }[];
    rankOrder: Record<string, number>;
  }[];

  for (const radius of RANKING_RADIUS_OPTIONS) {
    const shopsKey = `shops_${radius}`;
    const machinesKey = `machines_${radius}`;
    const metricOf = (e: (typeof campusEntries)[number]) =>
      e.rankings?.find((r) => r.radius === radius);

    campus[String(radius)] = {
      shops: campusEntries
        .filter((e) => typeof e.rankOrder?.[shopsKey] === 'number')
        .sort((a, b) => a.rankOrder[shopsKey] - b.rankOrder[shopsKey])
        .slice(0, TOP_N)
        .map((e) => ({ id: e.id, name: e.fullName, value: metricOf(e)?.shopCount ?? 0 })),
      machines: campusEntries
        .filter((e) => typeof e.rankOrder?.[machinesKey] === 'number')
        .sort((a, b) => a.rankOrder[machinesKey] - b.rankOrder[machinesKey])
        .slice(0, TOP_N)
        .map((e) => ({ id: e.id, name: e.fullName, value: metricOf(e)?.totalMachines ?? 0 }))
    };
  }

  // ---- Metro station leaderboards (0.2/0.5/1/2 km x shops / machines) ----
  const metro: HomeStatsResponse['metro'] = {};
  // Network metadata keyed by network id, so each station entry can carry the
  // network name as a sublabel (mirrors the region preview's parent name).
  const metroNetworksById = new Map(
    (
      (await db.collection('metro_station_rankings').findOne({ _id: 'metadata' } as never, {
        projection: { networks: 1 }
      })) as {
        networks?: { id: string; name: string; names?: { zh: string; en: string } }[];
      } | null
    )?.networks?.map((network) => [network.id, network] as const) ?? []
  );
  const metroNetworkName = (networkId: string): string => {
    const network = metroNetworksById.get(networkId);
    if (!network) return '';
    return network.names ? pickLocalizedName(network.names, network.name) : network.name;
  };
  const metroEntries = (await db
    .collection('metro_station_rankings')
    .find({ _id: { $ne: 'metadata' } } as never)
    .project({
      _id: 0,
      id: 1,
      networkId: 1,
      names: 1,
      name: 1,
      location: 1,
      rankings: 1,
      rankOrder: 1
    })
    .toArray()) as unknown as {
    id: string;
    networkId: string;
    name: string;
    names: { zh: string; en: string };
    location?: { lon: number; lat: number };
    rankings: { radius: number; shopCount: number; totalMachines: number }[];
    rankOrder: Record<string, number>;
  }[];

  for (const radius of METRO_RANKING_RADIUS_OPTIONS) {
    const shopsKey = metroRankingSortKey('shops', radius);
    const machinesKey = metroRankingSortKey('machines', radius);
    const metricOf = (e: (typeof metroEntries)[number]) =>
      e.rankings?.find((r) => r.radius === radius);

    metro[String(radius)] = {
      shops: metroEntries
        .filter((e) => typeof e.rankOrder?.[shopsKey] === 'number')
        .sort((a, b) => a.rankOrder[shopsKey] - b.rankOrder[shopsKey])
        .slice(0, TOP_N)
        .map((e) => ({
          id: e.id,
          name: pickLocalizedName(e.names, e.name),
          sublabel: metroNetworkName(e.networkId) || null,
          lat: e.location?.lat ?? 0,
          lon: e.location?.lon ?? 0,
          value: metricOf(e)?.shopCount ?? 0
        })),
      machines: metroEntries
        .filter((e) => typeof e.rankOrder?.[machinesKey] === 'number')
        .sort((a, b) => a.rankOrder[machinesKey] - b.rankOrder[machinesKey])
        .slice(0, TOP_N)
        .map((e) => ({
          id: e.id,
          name: pickLocalizedName(e.names, e.name),
          sublabel: metroNetworkName(e.networkId) || null,
          lat: e.location?.lat ?? 0,
          lon: e.location?.lon ?? 0,
          value: metricOf(e)?.totalMachines ?? 0
        }))
    };
  }

  return {
    totals: {
      shops: totalShops,
      machines: totalMachines,
      users: totalUsers
    },
    region,
    campus,
    metro
  };
};

interface CachedHomeStats {
  computedAt: number; // epoch ms
  data: HomeStatsResponse;
}

export const writeHomeStatsCache = async (stats: HomeStatsResponse): Promise<void> => {
  if (!redis) return;
  await ensureConnected();
  const payload: CachedHomeStats = { computedAt: Date.now(), data: stats };
  await redis.set(HOME_STATS_CACHE_KEY, JSON.stringify(payload), { EX: PHYSICAL_TTL_SECONDS });
};

export const readHomeStatsCache = async (): Promise<{
  stats: HomeStatsResponse;
  computedAt: number;
} | null> => {
  if (!redis) return null;
  await ensureConnected();
  const cached = await redis.get(HOME_STATS_CACHE_KEY);
  if (!cached) return null;
  try {
    const payload = JSON.parse(cached) as CachedHomeStats;
    // Backwards-compat: older cache entries were the bare stats object.
    const isWrapped = payload && typeof payload === 'object' && 'data' in payload;
    const stats = (isWrapped ? payload.data : (payload as HomeStatsResponse)) ?? null;
    const computedAt = isWrapped && typeof payload.computedAt === 'number' ? payload.computedAt : 0;
    if (!stats) return null;
    // Backwards-compat: payloads cached before the metro block existed.
    if (!stats.metro) stats.metro = {};
    return { stats, computedAt };
  } catch {
    return null;
  }
};
