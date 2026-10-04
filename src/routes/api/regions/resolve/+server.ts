import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { m } from '$lib/paraglide/messages';
import {
  initRegionCache,
  resolveRegionFromGeneral,
  resolveRegionNearPoint
} from '$lib/regions/utils.server';
import { googleRegeo } from '$lib/utils/google.server';
import { tencentRegeo } from '$lib/utils/tencent.server';
import { parseRegionChainFromText } from '$lib/regions/utils.server';
import mongo from '$lib/db/index.server';
import type { RequestHandler } from './$types';

/**
 * Resolve the region hierarchy at a coordinate for the shop form.
 *
 * GET /api/regions/resolve?lat=..&lng=..
 *
 * China: server-side AMap regeo (same credentials as the `_AMapService`
 * proxy) → region-ID hierarchy + street-level `detailed`.
 * Overseas: Google Geocoding API reverse geocoding (via `REVERSE_PROXY`)
 * → structured place names; the region chain is auto-selected only when a
 * same-country region name matches near the point (≤50 km, leaf preferred),
 * otherwise the caller keeps manual region selection. Results are cached in
 * memory (coordinates rounded to 5 decimals, 10 min) so re-picking the same
 * spot never re-burns provider quota.
 */
const CN_BOUNDS = { lngMin: 73, lngMax: 136, latMin: 3, latMax: 54 };
const CACHE_TTL_MS = 10 * 60 * 1000;

const cache = new Map<string, { at: number; value: ResolveLocationResponse }>();

interface ResolveLocationResponse {
  resolved: boolean;
  region?: string[];
  general?: string[];
  detailed?: string;
  needsManualRegion?: boolean;
  /** How the region chain was matched ('name' = component name, 'nearest' = closest terminal region). */
  matchedBy?: 'name' | 'nearest';
}

export const GET: RequestHandler = async ({ locals, url }) => {
  const session = locals.session;
  if (!session?.user) {
    error(401, m.unauthorized());
  }

  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    error(400, 'Invalid coordinates');
  }

  const cacheKey = `${lng.toFixed(5)},${lat.toFixed(5)}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return json(hit.value);
  }

  const result = await resolveLocation(
    lng,
    lat,
    url.origin,
    url.searchParams.get('address') ?? undefined
  );
  // Cache only fully-resolved results: negatives and detailed-only responses
  // stay uncached so matcher improvements and retries take effect immediately
  // (Google geocode is cheap; AMap regeo volume is tiny).
  if (result.resolved && result.region?.length) {
    cache.set(cacheKey, { at: Date.now(), value: result });
    if (cache.size > 500) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) cache.delete(oldest[0]);
    }
  }
  return json(result);
};

async function resolveLocation(
  lng: number,
  lat: number,
  referer: string,
  pickerAddress?: string
): Promise<ResolveLocationResponse> {
  // AMap regeo only covers China and expects GCJ-02; skip it for foreign coords.
  const inCn =
    lng >= CN_BOUNDS.lngMin &&
    lng <= CN_BOUNDS.lngMax &&
    lat >= CN_BOUNDS.latMin &&
    lat <= CN_BOUNDS.latMax;
  if (inCn) {
    // Don't fall through to Google inside China: Google returns WGS-84-based
    // data with poor CN coverage, while our stored CN coordinates are GCJ-02.
    // Tencent first: it is billed per day (hard daily quota), while AMap
    // shares a monthly pool — spend Tencent's idle quota before AMap's.
    const tencent = await resolveByTencent(lng, lat, referer);
    if (tencent) return tencent;
    const amap = await resolveByAmap(lng, lat);
    if (amap) return amap;
    // Last resort: parse the picker's formatted address into the hierarchy.
    return parsePickerAddress(pickerAddress);
  }

  // Overseas: Google reverse geocoding.
  return resolveByGoogle(lng, lat, referer);
}

async function resolveByTencent(
  lng: number,
  lat: number,
  referer: string
): Promise<ResolveLocationResponse | null> {
  const g = await tencentRegeo(lat, lng, referer);
  if (!g?.province) {
    console.error('[regions/resolve] Tencent regeo failed for', lng, lat);
    return null;
  }
  const names: string[] = [];
  for (const part of ['中国', g.province, g.city, g.district]) {
    if (part && part !== names[names.length - 1]) names.push(part);
  }
  await initRegionCache(mongo);
  const region = resolveRegionFromGeneral(names);
  if (!region || region.length === 0) {
    console.error('[regions/resolve] AMap general did not resolve:', names.join('/'));
    return null;
  }
  let detailed = g.formatted.trim();
  for (const name of [g.province, g.city, g.district]) {
    if (name && detailed.startsWith(name)) detailed = detailed.slice(name.length).trim();
  }
  return { resolved: true, region, general: names, detailed: detailed || g.formatted.trim() };
}

/**
 * Final fallback: parse the picker's formatted address text against the
 * region hierarchy (greedy longest-prefix per level) and return the matched
 * chain plus the unmatched remainder as the detailed address.
 */
function parsePickerAddress(pickerAddress?: string): ResolveLocationResponse {
  const text = pickerAddress?.trim();
  if (!text) return { resolved: false };
  const parsed = parseRegionChainFromText(text);
  if (!parsed) return { resolved: false, needsManualRegion: true };
  return {
    resolved: true,
    region: parsed.chain,
    general: parsed.general,
    detailed: parsed.remainder || text
  };
}

const POSTAL_RE = /\b\d{4,10}(?:[- ]\d{2,4})?\b|\b[A-Z]\d[A-Z](?: ?\d[A-Z]\d)?\b/;
const normSegment = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

async function resolveByGoogle(
  lng: number,
  lat: number,
  referer: string
): Promise<ResolveLocationResponse> {
  const g = await googleRegeo(lat, lng, referer);
  if (!g || !g.formatted) return { resolved: false };

  // Street-level detail: strip trailing administrative segments (country,
  // admin1/2, locality, postal) from the formatted address, keeping ≥1 part.
  const drop = new Set(
    [
      g.country.long,
      g.country.short,
      'usa',
      'uk',
      g.admin1?.long,
      g.admin1?.short,
      g.admin2,
      g.locality,
      g.postalTown,
      g.sublocality
    ]
      .filter((s): s is string => !!s)
      .map(normSegment)
  );
  const parts = g.formatted
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  while (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (drop.has(normSegment(last)) || POSTAL_RE.test(last)) parts.pop();
    else break;
  }

  // Region auto-select, two tiers: a same-country region whose name matches an
  // address component within 50 km (leaf preferred), else the nearest terminal
  // region within 25 km (pragmatic point-in-region proxy).
  await initRegionCache(mongo);
  const names = [
    g.locality,
    g.postalTown,
    g.sublocality,
    g.neighborhood,
    g.admin2,
    g.admin1?.long
  ].filter((s): s is string => !!s);
  const matched = await resolveRegionNearPoint(g.country.short, names, [lng, lat]);

  const general = [g.country.long, g.admin1?.long, g.admin2, g.locality].filter(
    (s): s is string => !!s
  );
  return {
    resolved: true,
    ...(matched ? { region: matched.chain, matchedBy: matched.matchedBy } : {}),
    general,
    detailed: parts.join(', ')
  };
}

async function resolveByAmap(lng: number, lat: number): Promise<ResolveLocationResponse | null> {
  // Runtime env: credentials rotate in the server .env without a rebuild.
  if (!env.AMAP_KEY || !env.AMAP_SECRET) return null;

  const regeoUrl = new URL('https://restapi.amap.com/v3/geocode/regeo');
  regeoUrl.searchParams.set('key', env.AMAP_KEY);
  regeoUrl.searchParams.set('jscode', env.AMAP_SECRET);
  regeoUrl.searchParams.set('location', `${lng.toFixed(6)},${lat.toFixed(6)}`);

  let data: {
    status?: string;
    regeocode?: {
      formatted_address?: string;
      addressComponent?: { province?: string; city?: string | string[]; district?: string };
    };
  };
  try {
    const response = await fetch(regeoUrl, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      console.error('[regions/resolve] AMap regeo HTTP', response.status);
      return null;
    }
    data = await response.json();
  } catch (err) {
    console.error('[regions/resolve] AMap regeo fetch failed:', (err as Error).message, (err as Error).cause);
    return null;
  }

  const component = data.regeocode?.addressComponent;
  const province = typeof component?.province === 'string' ? component.province.trim() : '';
  const cityRaw = Array.isArray(component?.city) ? component?.city?.[0] : component?.city;
  const city = typeof cityRaw === 'string' ? cityRaw.trim() : '';
  const district = typeof component?.district === 'string' ? component.district.trim() : '';
  if (!province) {
    console.error('[regions/resolve] AMap regeo returned no province for', lng, lat);
    return null;
  }

  // Municipalities repeat the province as the city; drop consecutive dupes.
  const names: string[] = [];
  for (const part of ['中国', province, city, district]) {
    if (part && part !== names[names.length - 1]) names.push(part);
  }

  await initRegionCache(mongo);
  const region = resolveRegionFromGeneral(names);
  if (!region || region.length === 0) return null;

  let detailed = data.regeocode?.formatted_address?.trim() ?? '';
  for (const name of [province, city, district]) {
    if (name && detailed.startsWith(name)) detailed = detailed.slice(name.length).trim();
  }
  if (!detailed) detailed = data.regeocode?.formatted_address?.trim() ?? '';

  return { resolved: true, region, general: names, detailed };
}
