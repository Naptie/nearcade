import { json } from '@sveltejs/kit';
import mongo from '$lib/db/index.server';
import { lookupIpRegion } from '$lib/endpoints/ip-lookup.server';
import type { Region } from '$lib/regions/types';
import type { RequestHandler } from './$types';

const CDN_IP_HEADERS = ['ali-cdn-real-ip', 'cf-connecting-ip'] as const;

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getCdnClientIp = (request: Request): string | null => {
  for (const header of CDN_IP_HEADERS) {
    const value = request.headers.get(header)?.trim();
    if (value) return value;
  }
  return null;
};

export const GET: RequestHandler = async ({ request }) => {
  const ip = getCdnClientIp(request);
  if (!ip) return json({ origin: null });

  const resolved = await lookupIpRegion(ip, request);
  const countryPrefix = resolved?.countryCode ? `${resolved.countryCode}-` : undefined;
  const findCoordinateRegion = async (name: string, level: Region['level']) => {
    const match = escapeRegex(name.trim());
    if (!match) return null;
    return mongo
      .db()
      .collection<Region>('regions')
      .find({
        level,
        location: { $ne: null },
        ...(countryPrefix ? { id: { $regex: `^${escapeRegex(countryPrefix)}` } } : {}),
        $or: [{ 'name.en': { $regex: match, $options: 'i' } }, { 'name.zh': { $regex: match } }]
      })
      .limit(1)
      .next();
  };

  // City is more precise; province is used only if no city coordinate can be
  // resolved. Fuzzy matching keeps the IP database's administrative labels
  // compatible with canonical region names without rewriting either one.
  const city = resolved?.city;
  const province = resolved?.regionName;
  const region =
    (city && city !== '0' ? await findCoordinateRegion(city, 'city') : null) ??
    (province && province !== '0' ? await findCoordinateRegion(province, 'province') : null);

  if (!region?.location) return json({ origin: null });

  const [lng, lat] = region.location.coordinates;
  return json(
    { origin: { lat, lng, source: 'ip-region' as const } },
    { headers: { 'Cache-Control': 'private, max-age=300' } }
  );
};
