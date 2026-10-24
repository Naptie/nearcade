import { implement } from '@orpc/server';
import { discoverContract } from '../contracts/discover';
import type { ApiContext } from '../context';
import { apiError, rethrowApiError } from '../errors';
import { toPlainWire } from '../wire.server';
import { loadShops } from '$lib/endpoints/discover.server';

import { discoverResponseSchema } from '$lib/schemas/discover';
import { m } from '$lib/paraglide/messages';

const impl = implement(discoverContract).$context<ApiContext>();

export const discoverImplementation = {
  list: impl.list.handler(async ({ input, context }) => {
    // The origin and the filters are the procedure's input — the contract
    // already validated them. They are put back into a query string because
    // the shared `loadShops` helper reads them from there, which is the shape
    // the REST endpoint delivers them in.
    //
    // Reading the request URL directly would tie the procedure to one mount:
    // on the typed RPC surface the input travels in the request body, and the
    // procedure would find no origin at all.
    const url = new URL(context.event.url);
    url.search = '';

    for (const [key, value] of Object.entries(input)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
    }

    // `loadShops` accepts `lat` / `lng` as aliases of `latitude` /
    // `longitude` and rejects a request that carries no origin at all.
    const hasLatitude = url.searchParams.has('latitude') || url.searchParams.has('lat');
    const hasLongitude = url.searchParams.has('longitude') || url.searchParams.has('lng');
    if (!hasLatitude || !hasLongitude) {
      apiError('BAD_REQUEST', m.latitude_and_longitude_parameters_are_required());
    }

    try {
      // `loadShops` is shared with the discover page and still speaks in
      // SvelteKit's `HttpError`; it returns the parsed body, so it is
      // plainified again before the contract validates it.
      return toPlainWire(discoverResponseSchema, await loadShops({ url }));
    } catch (err) {
      rethrowApiError(err, m.failed_to_get_nearby_shops());
    }
  })
};
