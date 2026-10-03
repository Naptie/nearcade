/**
 * Google Maps Platform reverse geocoding (Geocoding API), server-side.
 *
 * Google is unreachable from the origin network directly, so requests go
 * through the URL-prefix reverse proxy (`REVERSE_PROXY`) when configured —
 * the same mechanism avatar sync uses. The public Maps key works server-side
 * (verified: unrestricted); results are parsed into the structured subset the
 * region resolver needs. Returns null on any failure — callers degrade.
 */
import { env } from '$env/dynamic/private';

export interface GoogleRegeoResult {
  country: { long: string; short: string };
  admin1: { long: string; short: string } | null;
  admin2: string | null;
  locality: string | null;
  postalTown: string | null;
  sublocality: string | null;
  neighborhood: string | null;
  formatted: string;
  partial: boolean;
}

export const googleRegeo = async (
  lat: number,
  lng: number,
  referer: string
): Promise<GoogleRegeoResult | null> => {
  const key = env.PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) return null;

  const target = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  target.searchParams.set('latlng', `${lat},${lng}`);
  target.searchParams.set('language', 'en');
  target.searchParams.set('key', key);
  const url = env.REVERSE_PROXY
    ? `${env.REVERSE_PROXY}${encodeURIComponent(target.toString())}`
    : target.toString();

  try {
    const response = await fetch(url, {
      headers: { Referer: referer },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      status?: string;
      results?: {
        formatted_address?: string;
        partial_match?: boolean;
        address_components?: { long_name: string; short_name: string; types: string[] }[];
      }[];
    };
    if (data.status !== 'OK' || !data.results?.[0]) return null;

    const first = data.results[0];
    const pick = (type: string) => first.address_components?.find((c) => c.types.includes(type));
    const country = pick('country');
    if (!country) return null;
    const admin1 = pick('administrative_area_level_1');

    return {
      country: { long: country.long_name, short: country.short_name },
      admin1: admin1 ? { long: admin1.long_name, short: admin1.short_name } : null,
      admin2: pick('administrative_area_level_2')?.long_name ?? null,
      locality: pick('locality')?.long_name ?? null,
      postalTown: pick('postal_town')?.long_name ?? null,
      sublocality: pick('sublocality')?.long_name ?? pick('sublocality_level_1')?.long_name ?? null,
      neighborhood: pick('neighborhood')?.long_name ?? null,
      formatted: first.formatted_address ?? '',
      partial: first.partial_match ?? false
    };
  } catch {
    return null;
  }
};
