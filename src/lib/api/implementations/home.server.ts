import { implement } from '@orpc/server';
import { homeContract } from '../contracts/home';
import type { ApiContext } from '../context';
import { rethrowApiError } from '../errors';
import { toPlainWire } from '../wire.server';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { shopChangelogListResponseSchema } from '$lib/schemas/shops';
import {
  computeHomeStats,
  readHomeStatsCache,
  writeHomeStatsCache,
  HOME_STATS_FRESH_TTL_SECONDS
} from '$lib/utils/home-stats.server';
import { getRecentShopChangelogEntries } from '$lib/utils/shops/changelog.server';

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

/**
 * SvelteKit's `error()` throws an `HttpError`, which the oRPC layer would
 * flatten into a 500. The router-level `preserveHttpErrorStatus` middleware
 * re-throws those with their original status.
 */
const impl = implement(homeContract).$context<ApiContext>();

export const homeImplementation = {
  changelog: impl.changelog.handler(async ({ input, context }) => {
    const { page, limit } = input;

    try {
      const { entries, total } = await getRecentShopChangelogEntries(mongo, {
        limit,
        offset: (page - 1) * limit,
        viewer: context.session?.user ?? null
      });

      // The contract's output schema describes the wire form (ISO timestamps),
      // which is exactly what `toPlainWire` produces — oRPC validates and
      // decodes it before the response is serialized.
      const response = toPlainWire(shopChangelogListResponseSchema, {
        entries,
        total,
        page,
        limit,
        hasMore: page * limit < total,
        totalPages: Math.ceil(total / limit)
      });

      context.resHeaders?.set('Cache-Control', 'public, max-age=30');
      return response;
    } catch (err) {
      rethrowApiError(err, m.failed_to_fetch_changelog_entries());
    }
  }),

  stats: impl.stats.handler(async ({ context }) => {
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
        context.resHeaders?.set('Cache-Control', 'public, max-age=60');
        return stats;
      }
      // No usable cache at all — compute synchronously and store it below.

      const stats = await computeHomeStats(mongo);

      try {
        await writeHomeStatsCache(stats);
      } catch (cacheError) {
        console.error('Error writing home stats cache:', cacheError);
      }

      context.resHeaders?.set('Cache-Control', 'public, max-age=60');
      return stats;
    } catch (err) {
      rethrowApiError(err, m.internal_server_error());
    }
  })
};
