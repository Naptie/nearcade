import { isHttpError, isRedirect, json } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import redis, { ensureConnected } from '$lib/db/redis.server';
import { m } from '$lib/paraglide/messages';
import { getLocale } from '$lib/paraglide/runtime';
import type { Shop } from '$lib/types';
import { RANKING_RADIUS_OPTIONS } from '$lib/constants';
import { expandRegionHierarchyWithNames } from '$lib/regions/utils.server';

const pickLocalizedName = (name: Record<string, string>, fallback: string): string => {
  const locale = getLocale();
  return (
    name[locale] ?? name[locale.split('-')[0]] ?? name.en ?? Object.values(name)[0] ?? fallback
  );
};

const CACHE_KEY = 'nearcade:home:stats';
// Data is considered fresh for 1 hour; the physical Redis key is kept much
// longer (1 day) so a stale payload can still be served instantly while a
// background recompute runs (stale-while-revalidate).
const FRESH_TTL_SECONDS = 3600; // 1 hour
const PHYSICAL_TTL_SECONDS = 86400; // 1 day
const TOP_N = 10;

// Avoid stampeding the expensive aggregation when many requests hit an
// expired cache simultaneously — only one background recompute at a time.
let recomputeInFlight: Promise<void> | null = null;

interface CachedHomeStats {
  computedAt: number; // epoch ms
  data: HomeStatsResponse;
}

const writeCache = async (stats: HomeStatsResponse) => {
  if (!redis) return;
  await ensureConnected();
  const payload: CachedHomeStats = { computedAt: Date.now(), data: stats };
  await redis.set(CACHE_KEY, JSON.stringify(payload), { EX: PHYSICAL_TTL_SECONDS });
};

const refreshCacheInBackground = () => {
  if (recomputeInFlight) return;
  recomputeInFlight = (async () => {
    try {
      const stats = await computeHomeStats();
      await writeCache(stats);
    } catch (err) {
      console.error('Error refreshing home stats cache:', err);
    } finally {
      recomputeInFlight = null;
    }
  })();
};

interface HomeStatsResponse {
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
}

const computeHomeStats = async (): Promise<HomeStatsResponse> => {
  const db = mongo.db();

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

  return {
    totals: {
      shops: totalShops,
      machines: totalMachines,
      users: totalUsers
    },
    region,
    campus
  };
};

export const GET: RequestHandler = async () => {
  try {
    // Serve stale-while-revalidate: any cached payload (fresh or stale) is
    // returned immediately; a stale one triggers a background recompute.
    if (redis) {
      try {
        await ensureConnected();
        const cached = await redis.get(CACHE_KEY);
        if (cached) {
          const payload = JSON.parse(cached) as CachedHomeStats;
          // Backwards-compat: older cache entries were the bare stats object.
          const isWrapped = payload && typeof payload === 'object' && 'data' in payload;
          const stats = (isWrapped ? payload.data : (payload as HomeStatsResponse)) ?? null;
          const computedAt =
            isWrapped && typeof payload.computedAt === 'number' ? payload.computedAt : 0;
          if (stats) {
            const isStale = Date.now() - computedAt > FRESH_TTL_SECONDS * 1000;
            if (isStale) {
              // Stale — refresh in the background, don't block the response.
              refreshCacheInBackground();
            }
            return json(stats, {
              headers: { 'Cache-Control': 'public, max-age=60' }
            });
          }
        }
        // No usable cache at all — compute synchronously and store it below.
      } catch (cacheError) {
        console.error('Error reading home stats cache:', cacheError);
      }
    }

    const stats = await computeHomeStats();

    try {
      await writeCache(stats);
    } catch (cacheError) {
      console.error('Error writing home stats cache:', cacheError);
    }

    return json(stats, {
      headers: { 'Cache-Control': 'public, max-age=60' }
    });
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error getting home stats:', err);
    error(500, m.internal_server_error());
  }
};
