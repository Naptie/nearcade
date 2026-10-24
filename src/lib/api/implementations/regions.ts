import { implement } from '@orpc/server';
import { regionsContract } from '../contracts/regions';
import type { ApiContext } from '../context';
import { apiError, rethrowApiError } from '../errors';
import { getRegionHierarchyByIds, getSelectorOptions } from '$lib/regions/utils.server';
import { resolvePoint } from '$lib/regions/resolve.server';

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

  resolve: impl.resolve.handler(async ({ input, context }) => {
    // No session check here: the contract declares `guard: 'session'`, so the
    // router-level `enforceAuthGuard` has already answered 401 for an
    // unauthenticated request. Repeating it would be a second source of truth
    // for a decision the contract owns.
    //
    // The resolution itself lives in `resolvePoint`: the datum rule, the
    // upstream call and the cache are one implementation, shared with every
    // other caller of the operation. This endpoint only publishes the answer.
    const result = await resolvePoint({
      longitude: input.longitude,
      latitude: input.latitude,
      coordinateSystem: input.coordinateSystem,
      address: input.address,
      language: input.language
    });

    // The answer depends on the requested language and on the caller's
    // identity, so a shared cache must not store it.
    context.resHeaders?.set('Cache-Control', 'private, max-age=300');

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
