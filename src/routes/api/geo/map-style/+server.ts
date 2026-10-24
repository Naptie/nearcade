import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import {
  fetchUnifiedGeoStyle,
  requestUnifiedGeoProfile
} from '$lib/utils/unified-geo.server';
import type { RequestHandler } from './$types';

const mapStyleQuerySchema = z.object({
  longitude: z.coerce.number().min(-180).max(180),
  latitude: z.coerce.number().min(-90).max(90),
  theme: z.enum(['dark', 'light']).optional(),
  // Some callers pass multi-market locale values (zh-CN,en-US); take the first
  // recognized tag instead of rejecting the request.
  locale: z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((tag) => tag.trim())
        .find((tag) => tag === 'zh-CN' || tag === 'en-US' || tag.startsWith('zh'))
    )
    .optional(),
  scope: z.enum(['regional', 'global']).optional()
});

interface MapStyleResponse {
  profile: Record<string, unknown>;
  style: unknown;
}

/**
 * Resolve the render-ready map profile for a point and fetch the MapLibre
 * style document it points at, in one request. The response carries both the
 * profile (for the unified-geo-client MapLibre adapter) and the style itself,
 * with the upstream Cache-Control header passed through (public, max-age=86400
 * for the built-in styles; private, no-store for live raster sessions).
 */
export const GET: RequestHandler = async ({ url }) => {
  const parsed = mapStyleQuerySchema.safeParse({
    longitude: url.searchParams.get('longitude') ?? undefined,
    latitude: url.searchParams.get('latitude') ?? undefined,
    theme: url.searchParams.get('theme') ?? undefined,
    locale: url.searchParams.get('locale') ?? undefined,
    scope: url.searchParams.get('scope') ?? undefined
  });
  if (!parsed.success) error(400, 'Invalid map style request.');

  const { longitude, latitude, theme, locale, scope } = parsed.data;
  const profile = await requestUnifiedGeoProfile({
    coordinate: { longitude, latitude, coordinateSystem: 'WGS84' },
    ...(scope ? { scope } : {}),
    ...(theme ? { style: theme } : {}),
    ...(locale ? { locale } : {})
  });
  const styleUrl = profile['styleUrl'];
  if (typeof styleUrl !== 'string') {
    error(503, 'The location service has no map source configured for this point.');
  }

  const { body, cacheControl } = await fetchUnifiedGeoStyle(styleUrl);
  let style: unknown;
  try {
    style = JSON.parse(body);
  } catch {
    error(502, 'The location service returned an invalid style document.');
  }

  const response: MapStyleResponse = {
    profile: profile as Record<string, unknown>,
    style
  };
  return json(response, {
    headers: {
      ...(cacheControl ? { 'cache-control': cacheControl } : {})
    }
  });
};
