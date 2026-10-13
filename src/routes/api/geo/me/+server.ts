import { json } from '@sveltejs/kit';
import mongo from '$lib/db/index.server';
import { lookupIpRegion } from '$lib/endpoints/ip-lookup.server';
import type { Region } from '$lib/regions/types';
import { isAllowedCorsOrigin } from '$lib/utils/cors.server';
import { getClientIp } from '$lib/utils/ip.server';
import type { RequestHandler } from './$types';

const escapeRegex = (value: string) => value.replace(/[.*+?${}()|[\]\\]/g, '\\$&');

interface OriginRegion {
  id: string;
  level: Region['level'];
  coordinates: [number, number];
}

/**
 * Find a named region inside the resolved country carrying a usable center.
 * CN/HK/MO/TW IDs are `CN-44`, while overseas pipeline IDs are `AU:4411` —
 * match both separators so non-Chinese IPs resolve too.
 */
const findCoordinateRegion = async (
  countryPrefix: string | undefined,
  name: string | null,
  level: Region['level']
): Promise<OriginRegion | null> => {
  const trimmed = name?.trim();
  if (!trimmed || trimmed === '0') return null;
  const match = escapeRegex(trimmed);
  const region = await mongo
    .db()
    .collection<Region>('regions')
    .find({
      level,
      location: { $ne: null },
      ...(countryPrefix ? { id: { $regex: `^${escapeRegex(countryPrefix)}[-:]` } } : {}),
      $or: [{ 'name.en': { $regex: match, $options: 'i' } }, { 'name.zh': { $regex: match } }]
    })
    .limit(1)
    .next();
  if (!region?.location) return null;
  return {
    id: region.id,
    level: region.level,
    coordinates: region.location.coordinates
  };
};

/**
 * Resolve the visitor's coarse origin from their IP: ip2region names a city
 * (or province/state when the city is unknown), and that name is matched
 * against the regions hierarchy to borrow its center coordinates. City wins
 * over province for precision; the response tells the caller which level the
 * point came from so a city centroid is not rendered like a personal fix.
 */
export const GET: RequestHandler = async (event) => {
  const { request, url } = event;
  if (!isAllowedCorsOrigin(request.headers.get('origin'), url.origin)) {
    return json({ origin: null }, { status: 403 });
  }

  const ip = getClientIp(event);
  if (!ip) return json({ origin: null });

  const resolved = await lookupIpRegion(ip, request);
  if (!resolved) return json({ origin: null });

  const countryPrefix = resolved.countryCode ?? undefined;
  const origin =
    (await findCoordinateRegion(countryPrefix, resolved.city, 'city')) ??
    (await findCoordinateRegion(countryPrefix, resolved.regionName, 'province'));
  if (!origin) return json({ origin: null });

  const [lng, lat] = origin.coordinates;
  return json(
    { origin: { lat, lng, level: origin.level, source: 'ip-region' as const } },
    { headers: { 'Cache-Control': 'private, max-age=300' } }
  );
};
