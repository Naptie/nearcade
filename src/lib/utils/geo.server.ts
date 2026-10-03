/**
 * Server-side coordinate translation into GCJ-02 ("Mars coordinates").
 *
 * Provider chain: Tencent coord translate first (per-feature daily quota,
 * currently barely used, SK-signed server-side) → AMap coordinate convert as
 * the fallback. Translation is never done locally — the provider owns the
 * datum. Returns null when every provider fails; callers keep the original
 * coordinates in that case.
 */
import { env } from '$env/dynamic/private';
import { tencentTranslateToGcj02 } from './tencent.server';

export type CoordSource = 'gps' | 'baidu' | 'mapbar';

/** AMap fallback: direct restapi call, "lng,lat" (lng-first) response. */
const amapTranslateToGcj02 = async (
  lng: number,
  lat: number,
  from: CoordSource
): Promise<[number, number] | null> => {
  const key = env.AMAP_KEY;
  if (!key) return null;
  const url = new URL('https://restapi.amap.com/v3/assistant/coordinate/convert');
  url.searchParams.set('key', key);
  url.searchParams.set('locations', `${lng},${lat}`);
  url.searchParams.set('coordsys', from);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const data = (await response.json()) as { status?: string; locations?: string };
    if (data.status !== '1' || !data.locations) return null;
    const [convertedLng, convertedLat] = data.locations.split(';')[0].split(',').map(Number);
    if (Number.isNaN(convertedLng) || Number.isNaN(convertedLat)) return null;
    return [convertedLng, convertedLat];
  } catch {
    return null;
  }
};

/**
 * Translate `[lng, lat]` from `from` into GCJ-02, or null on total failure.
 * `referer` is forwarded to Tencent for domain-authorized keys.
 */
export const translateToGcj02 = async (
  lng: number,
  lat: number,
  from: CoordSource,
  referer: string
): Promise<[number, number] | null> =>
  (await tencentTranslateToGcj02(lng, lat, from, referer)) ??
  (await amapTranslateToGcj02(lng, lat, from));
