import { implement } from '@orpc/server';
import { globeContract } from '../contracts/globe';
import type { ApiContext } from '../context';
import { apiError } from '../errors';
import {
  loadGlobeDataResponse,
  loadGlobeMarkers,
  loadGlobeShopsByDistance,
  loadGlobeShopsByIds,
  loadGlobeShopsByName
} from '$lib/endpoints/globe.server';
import { readGlobeFilterState } from '$lib/utils/shops/filter';
import { convertToMapProfile } from '$lib/utils/geo.server';

const MAX_IDS_PER_REQUEST = 200;
const MAX_TITLE_IDS = 50;

const CACHE_CONTROL = 'public, max-age=120, stale-while-revalidate=600';

/** The comma separated list of game title IDs the globe filters on. */
const parseTitleIds = (raw: string | undefined): number[] =>
  Array.from(
    new Set(
      (raw ?? '')
        .split(',')
        .map((value) => Number.parseInt(value.trim(), 10))
        .filter(Number.isInteger)
    )
  );

/**
 * The filter parameters the globe reads from the request URL.
 *
 * `region` is the globe's pre-filter parameter; it now arrives as a `regions`
 * slot in `f`, so old clients and shared links keep hitting the same query.
 */
const globeFilterParams = (input: { f?: string; region?: string }): URLSearchParams => {
  const params = new URLSearchParams();
  if (input.f !== undefined) params.set('f', input.f);
  if (input.region !== undefined) params.set('region', input.region);
  return params;
};

const impl = implement(globeContract).$context<ApiContext>();

export const globeImplementation = {
  data: impl.data.handler(async ({ context }) => {
    const response = await loadGlobeDataResponse();
    context.resHeaders?.set('Cache-Control', 'no-store');
    return response;
  }),

  markers: impl.markers.handler(async ({ input, context }) => {
    const titleIds = parseTitleIds(input.titles);
    const filter = readGlobeFilterState(globeFilterParams(input));

    if (titleIds.length > MAX_TITLE_IDS) {
      apiError('BAD_REQUEST', `Too many game titles: maximum ${MAX_TITLE_IDS}`);
    }

    const shops = await loadGlobeMarkers({ titleIds, filter });
    context.resHeaders?.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    return { shops };
  }),

  shops: impl.shops.handler(async ({ input, context }) => {
    const idsParam = input.ids;
    const titleIds = parseTitleIds(input.titles);
    const filter = readGlobeFilterState(globeFilterParams(input));
    const offset = input.offset ?? 0;

    if (titleIds.length > MAX_TITLE_IDS) {
      apiError('BAD_REQUEST', `Too many game titles: maximum ${MAX_TITLE_IDS}`);
    }

    if (input.lat !== undefined || input.lng !== undefined) {
      let latitude = input.lat ?? 0;
      let longitude = input.lng ?? 0;
      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        apiError('BAD_REQUEST', 'lat or lng is out of range');
      }

      // The origin is compared with the stored shops, which live in the map
      // surface's datum. A caller that sends a point in another datum says so,
      // and the point is moved into that space before it is used as the
      // anchor — the same rule `/discover` follows.
      if (input.convertFrom) {
        const converted = await convertToMapProfile(longitude, latitude, input.convertFrom);
        if (converted) {
          longitude = converted.longitude;
          latitude = converted.latitude;
        } else {
          console.error('Unified geo coordinate routing failed; using original coordinates');
        }
      }

      const page = await loadGlobeShopsByDistance(longitude, latitude, offset, {
        titleIds,
        filter
      });
      context.resHeaders?.set('Cache-Control', CACHE_CONTROL);
      return page;
    }

    if (!idsParam) {
      const page = await loadGlobeShopsByName(offset, { titleIds, filter });
      context.resHeaders?.set('Cache-Control', CACHE_CONTROL);
      return page;
    }

    const ids = idsParam
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));

    if (ids.length === 0) {
      apiError('BAD_REQUEST', 'No valid shop IDs provided');
    }

    if (ids.length > MAX_IDS_PER_REQUEST) {
      apiError('BAD_REQUEST', `Too many IDs: maximum ${MAX_IDS_PER_REQUEST} per request`);
    }

    const shops = await loadGlobeShopsByIds(ids);
    context.resHeaders?.set('Cache-Control', CACHE_CONTROL);
    return { shops };
  })
};
