/**
 * Tencent Maps WebService server-side helpers.
 *
 * Auth: keys may be domain-whitelist-validated (Referer) and/or SK-signed.
 * - `TENCENT_MAPS_KEY` (server key) takes precedence over the public key.
 * - When `TENCENT_MAPS_SK` is set, requests are signed with
 *   `sig = md5(path?sortedParams + SK)` (Tencent WebService signature scheme).
 * - Otherwise the request origin is sent as Referer for domain-authorized keys.
 */
import { env } from '$env/dynamic/private';
import { createHash } from 'node:crypto';

type TranslateFrom = 'gps' | 'baidu' | 'mapbar';

// Tencent ws/coord/v1/translate `type` values (differ from AMap's):
// 1 = GPS (WGS-84), 2 = sogou, 3 = Baidu (BD-09), 4 = mapbar.
const TENCENT_TYPE: Record<TranslateFrom, string> = { gps: '1', baidu: '3', mapbar: '4' };

/** Tencent WebService SK signature: md5(path?sortedParams + SK). */
const tencentSig = (path: string, params: Record<string, string>, sk: string): string => {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return createHash('md5').update(`${path}?${sorted}${sk}`, 'utf8').digest('hex');
};

/**
 * Translate a coordinate into GCJ-02 via Tencent. Returns `[lng, lat]` or
 * null on any failure (caller decides the fallback). Coordinates are
 * memoized per ~100 m grid to keep repeat traffic off the daily quota.
 */
const translateMemo = new Map<string, [number, number]>();

export const tencentTranslateToGcj02 = async (
  lng: number,
  lat: number,
  from: TranslateFrom,
  referer: string
): Promise<[number, number] | null> => {
  const key = env.TENCENT_MAPS_KEY || env.PUBLIC_TENCENT_MAPS_KEY;
  if (!key) return null;

  const memoKey = `${from}:${lng.toFixed(3)},${lat.toFixed(3)}`;
  const cached = translateMemo.get(memoKey);
  if (cached) return cached;

  const path = '/ws/coord/v1/translate';
  const params: Record<string, string> = {
    key,
    // Tencent expects latitude first here.
    locations: `${lat},${lng}`,
    type: TENCENT_TYPE[from]
  };
  const sk = env.TENCENT_MAPS_SK;
  if (sk) params.sig = tencentSig(path, params, sk);

  const url = new URL(`https://apis.map.qq.com${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  try {
    const response = await fetch(url, {
      headers: { Referer: referer },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      status?: number;
      locations?: { lat: number; lng: number }[];
    };
    const converted = data.status === 0 ? data.locations?.[0] : undefined;
    if (!converted) return null;
    const result: [number, number] = [converted.lng, converted.lat];
    translateMemo.set(memoKey, result);
    if (translateMemo.size > 500) {
      translateMemo.delete(translateMemo.keys().next().value as string);
    }
    return result;
  } catch {
    return null;
  }
};

export interface TencentRegeo {
  province: string;
  city: string;
  district: string;
  formatted: string;
}

/** Tencent reverse geocode (逆地址解析), SK-signed server-side. Null on failure. */
export const tencentRegeo = async (
  lat: number,
  lng: number,
  referer: string
): Promise<TencentRegeo | null> => {
  const key = env.TENCENT_MAPS_KEY || env.PUBLIC_TENCENT_MAPS_KEY;
  if (!key) return null;
  const path = '/ws/geocoder/v1/';
  const params: Record<string, string> = { key, location: `${lat.toFixed(6)},${lng.toFixed(6)}` };
  const sk = env.TENCENT_MAPS_SK;
  if (sk) params.sig = tencentSig(path, params, sk);
  const url = new URL(`https://apis.map.qq.com${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const response = await fetch(url, {
      headers: { Referer: referer },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      status?: number;
      geocode?: {
        address_component?: { province?: string; city?: string; district?: string };
        formatted_addresses?: { recommend?: string };
      };
    };
    const comp = data.status === 0 ? data.geocode?.address_component : undefined;
    if (!comp?.province) return null;
    return {
      province: comp.province ?? '',
      city: comp.city ?? '',
      district: comp.district ?? '',
      formatted:
        data.geocode?.formatted_addresses?.recommend ??
        data.geocode?.address_component?.province ??
        ''
    };
  } catch {
    return null;
  }
};
