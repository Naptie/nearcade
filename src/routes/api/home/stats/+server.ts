import { isHttpError, isRedirect, json } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import {
  computeHomeStats,
  readHomeStatsCache,
  writeHomeStatsCache,
  HOME_STATS_FRESH_TTL_SECONDS
} from '$lib/utils/home-stats.server';

// Avoid stampeding the expensive aggregation when many requests hit an
// expired cache simultaneously — only one background recompute at a time.
let recomputeInFlight: Promise<void> | null = null;

const refreshCacheInBackground = () => {
  if (recomputeInFlight) return;
  recomputeInFlight = (async () => {
    try {
      const stats = await computeHomeStats(mongo);
      await writeHomeStatsCache(stats);
    } catch (err) {
      console.error('Error refreshing home stats cache:', err);
    } finally {
      recomputeInFlight = null;
    }
  })();
};

export const GET: RequestHandler = async () => {
  try {
    // Serve stale-while-revalidate: any cached payload (fresh or stale) is
    // returned immediately; a stale one triggers a background recompute.
    const cached = await readHomeStatsCache();
    if (cached) {
      const { stats, computedAt } = cached;
      const isStale = Date.now() - computedAt > HOME_STATS_FRESH_TTL_SECONDS * 1000;
      if (isStale) {
        // Stale — refresh in the background, don't block the response.
        refreshCacheInBackground();
      }
      return json(stats, {
        headers: { 'Cache-Control': 'public, max-age=60' }
      });
    }
    // No usable cache at all — compute synchronously and store it below.

    const stats = await computeHomeStats(mongo);

    try {
      await writeHomeStatsCache(stats);
    } catch (cacheError) {
      console.error('Error writing home stats cache:', cacheError);
    }

    return json(stats, {
      headers: { 'Cache-Control': 'public, max-age=60' }
    });
  } catch (err) {
    if (isHttpError(err) || isRedirect(err)) {
      throw err;
    }
    console.error('Error getting home stats:', err);
    error(500, m.internal_server_error());
  }
};
