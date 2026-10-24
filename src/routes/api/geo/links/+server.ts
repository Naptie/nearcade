import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { isAllowedCorsOrigin } from '$lib/utils/cors.server';
import { requestUnifiedGeo } from '$lib/utils/unified-geo.server';
import type { RequestHandler } from './$types';

const linksSchema = z.object({
  longitude: z.coerce.number().min(-180).max(180),
  latitude: z.coerce.number().min(-90).max(90),
  name: z.string().max(80).optional(),
  mode: z.enum(['view', 'navigation']).optional(),
  travelMode: z.enum(['driving', 'walking', 'cycling', 'transit']).optional(),
  coordinateSystem: z.enum(['WGS84', 'GCJ02']).optional()
});

/**
 * Proxy unified-geo's platform map links (POST /maps/links): a cross-platform
 * geo: fallback, a native chooser link for Android, a deep link for iOS, and a
 * web fallback routed by the point's zone. The client picks the link for the
 * detected platform.
 */
export const GET: RequestHandler = async ({ request, url }) => {
  if (!isAllowedCorsOrigin(request.headers.get('origin'), url.origin)) {
    error(403, 'Cross-origin map link requests are not allowed.');
  }

  const parsed = linksSchema.safeParse({
    longitude: url.searchParams.get('longitude') ?? undefined,
    latitude: url.searchParams.get('latitude') ?? undefined,
    name: url.searchParams.get('name') ?? undefined,
    mode: url.searchParams.get('mode') ?? undefined,
    travelMode: url.searchParams.get('travelMode') ?? undefined,
    coordinateSystem: url.searchParams.get('coordinateSystem') ?? undefined
  });
  if (!parsed.success) error(400, 'Invalid map link request.');

  const { longitude, latitude, name, mode, travelMode, coordinateSystem } = parsed.data;
  const response = await requestUnifiedGeo<{
    success: true;
    universal: string;
    android?: string;
    ios?: string;
    web?: string;
  }>('/maps/links', {
    coordinate: { longitude, latitude, coordinateSystem: coordinateSystem ?? 'WGS84' },
    ...(name ? { name } : {}),
    ...(mode ? { mode } : {}),
    ...(travelMode ? { travelMode } : {})
  });

  return json(response, {
    headers: { 'cache-control': 'public, max-age=300' }
  });
};
