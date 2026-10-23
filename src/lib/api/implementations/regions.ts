import { implement } from '@orpc/server';
import { regionsContract } from '../contracts/regions';
import type { ApiContext } from '../context';
import { apiError, rethrowApiError } from '../errors';
import { getRegionHierarchyByIds, getSelectorOptions } from '$lib/regions/utils.server';
import {
  resolveNearcadeRegion,
  type UnifiedGeoReverseResponse
} from '$lib/regions/unified-geo.server';
import { requestUnifiedGeo, type UnifiedGeoCoordinate } from '$lib/utils/unified-geo.server';

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<
  string,
  { at: number; value: Awaited<ReturnType<typeof resolveNearcadeRegion>> }
>();

const impl = implement(regionsContract).$context<ApiContext>();

export const regionsImplementation = {
  list: impl.list.handler(async ({ input, context }) => {
    const parentId = input?.parentId || null;
    const locale = input?.locale || 'en';

    try {
      const options = await getSelectorOptions(parentId, locale);
      context.resHeaders?.set(
        'Cache-Control',
        'public, max-age=3600, stale-while-revalidate=86400'
      );
      return options;
    } catch (err) {
      rethrowApiError(err, 'Failed to load region options');
    }
  }),

  resolve: impl.resolve.handler(async ({ input }) => {
    // No session check here: the contract declares `guard: 'session'`, so the
    // router-level `enforceAuthGuard` has already answered 401 for an
    // unauthenticated request. Repeating it would be a second source of truth
    // for a decision the contract owns.
    const coordinate: UnifiedGeoCoordinate = {
      longitude: input.lng,
      latitude: input.lat,
      coordinateSystem: input.coordinateSystem ?? 'WGS84'
    };

    const cacheKey = `${coordinate.coordinateSystem}:${input.lng.toFixed(5)},${input.lat.toFixed(5)}`;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

    const reverse = await requestUnifiedGeo<UnifiedGeoReverseResponse>('/geo/reverse', {
      coordinate,
      outputCoordinateSystem: 'WGS84'
    });
    const result = await resolveNearcadeRegion(reverse, input.address);

    if (result.resolved && result.region?.length) {
      cache.set(cacheKey, { at: Date.now(), value: result });
      if (cache.size > 500) {
        const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (oldest) cache.delete(oldest[0]);
      }
    }

    return result;
  }),

  hierarchy: impl.hierarchy.handler(async ({ input, context }) => {
    const ids = input.ids.split('/').filter(Boolean);
    const locale = input.locale || 'en';

    if (ids.length === 0) {
      apiError('BAD_REQUEST', 'At least one region ID is required');
    }

    try {
      const result = await getRegionHierarchyByIds(ids, locale);

      if (!result) {
        apiError('NOT_FOUND', 'Invalid region ID path');
      }

      context.resHeaders?.set(
        'Cache-Control',
        'public, max-age=3600, stale-while-revalidate=86400'
      );

      return result;
    } catch (err) {
      rethrowApiError(err, 'Failed to resolve region hierarchy');
    }
  })
};
