import { error } from '@sveltejs/kit';
import { resolveTerritoryDatum } from '$lib/utils/geo.server';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, parent }) => {
  const { session } = await parent();
  const lat = url.searchParams.get('lat');
  const lng = url.searchParams.get('lng');
  const address = url.searchParams.get('address');

  // A handoff point was picked on the globe, whose surface follows the
  // territory datum (GCJ02 on the mainland and in the SARs, WGS84 elsewhere).
  // Which one it is depends on where the point is, so the location service
  // answers it — the same territory rule the write path stamps the shop with.
  let initialCoordinateSystem: Awaited<ReturnType<typeof resolveTerritoryDatum>> | null = null;
  if (lat && lng) {
    try {
      initialCoordinateSystem = await resolveTerritoryDatum(parseFloat(lng), parseFloat(lat));
    } catch {
      error(503, 'The location service is unavailable.');
    }
  }

  return {
    initialLat: lat ? parseFloat(lat) : null,
    initialLng: lng ? parseFloat(lng) : null,
    initialCoordinateSystem,
    initialAddress: address ?? null,
    user: session?.user
  };
};
