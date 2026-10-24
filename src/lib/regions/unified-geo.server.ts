import mongo from '$lib/db/index.server';
import {
  initRegionCache,
  parseRegionChainFromText,
  resolveRegionFromGeneral,
  resolveRegionNearPoint
} from '$lib/regions/utils.server';
import type { UnifiedGeoCoordinate } from '$lib/utils/unified-geo.server';

export interface UnifiedGeoReverseResponse {
  success: true;
  provider: string;
  serviceArea: 'china' | 'international';
  zone?: 'CN_MAINLAND' | 'CN_HKMO' | 'CN_TW' | 'INTERNATIONAL' | 'UNKNOWN';
  territory: {
    countryCode: string;
    country: string;
    region?: string;
    city?: string;
    district?: string;
    datum?: 'WGS84' | 'GCJ02';
    normalizedInput: UnifiedGeoCoordinate;
  };
  results: {
    formattedAddress: string;
    components: {
      countryCode?: string;
      country?: string;
      region?: string;
      city?: string;
      district?: string;
    };
  }[];
}

/**
 * The part of a reverse-geocode answer the region derivation actually reads.
 *
 * The upstream envelope also carries `success` and `provider`. The region
 * chain depends on neither — `provider` names which map provider answered,
 * which is the geo service's business and not something a region is derived
 * from — and naming the fields the derivation reads keeps that derivation
 * independent of the envelope it happens to receive.
 */
export interface NearcadeReverseGeocode {
  serviceArea: 'china' | 'international';
  zone?: 'CN_MAINLAND' | 'CN_HKMO' | 'CN_TW' | 'INTERNATIONAL' | 'UNKNOWN';
  territory: {
    countryCode: string;
    country: string;
    region?: string;
    city?: string;
    district?: string;
    datum?: 'WGS84' | 'GCJ02';
    normalizedInput: UnifiedGeoCoordinate;
  };
  results: {
    formattedAddress: string;
    components: {
      countryCode?: string;
      country?: string;
      region?: string;
      city?: string;
      district?: string;
    };
  }[];
}

export interface NearcadeRegionResolution {
  resolved: boolean;
  /**
   * The region ID chain, root → leaf.
   *
   * Absent when the chain could not be resolved; `needsManualRegion` then
   * tells the caller the user has to pick a region by hand.
   */
  chain?: string[];
  general: string[];
  detailed: string;
  needsManualRegion?: boolean;
  matchedBy?: 'name' | 'nearest';
}

function uniqueParts(parts: Array<string | undefined>): string[] {
  return parts.reduce<string[]>((unique, part) => {
    const value = part?.trim();
    if (value && value !== unique.at(-1)) unique.push(value);
    return unique;
  }, []);
}

function formatDetailedAddress(
  formattedAddress: string,
  countryCode: string,
  administrativeParts: string[],
  countryName: string,
  fallbackAddress?: string
): string {
  const formatted = formattedAddress.trim();
  if (!formatted) return fallbackAddress?.trim() ?? '';

  if (['CN', 'HK', 'MO', 'TW'].includes(countryCode)) {
    let detail = formatted;
    for (const part of ['中国', ...administrativeParts]) {
      if (part && detail.startsWith(part)) detail = detail.slice(part.length);
    }
    detail = detail.replace(/^[,，\s]+/, '').trim();
    if (detail && detail !== formatted) return detail;
  }

  const normalize = (value: string) => value.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  const removable = new Set([...administrativeParts, countryName].map(normalize));
  removable.add(countryCode.toLocaleLowerCase());
  const parts = formatted
    .split(/[,，]/)
    .map((part) => part.trim())
    .filter(Boolean);
  while (parts.length > 1 && removable.has(normalize(parts[0]!))) parts.shift();
  while (parts.length > 1 && removable.has(normalize(parts.at(-1)!))) parts.pop();
  return parts.join(', ') || formatted || fallbackAddress?.trim() || '';
}

export async function resolveNearcadeRegion(
  reverse: NearcadeReverseGeocode,
  fallbackAddress?: string
): Promise<NearcadeRegionResolution> {
  const territory = reverse.territory;
  const components = reverse.results[0]?.components ?? {};
  const countryCode = (territory.countryCode || components.countryCode || '').toUpperCase();
  const isChinaHierarchy = ['CN', 'HK', 'MO', 'TW'].includes(countryCode);
  const administrativeParts = uniqueParts([
    territory.region ?? components.region,
    territory.city ?? components.city,
    territory.district ?? components.district
  ]);
  const formattedAdministrativeParts = uniqueParts([
    territory.region,
    components.region,
    territory.city,
    components.city,
    territory.district,
    components.district
  ]);
  const general = isChinaHierarchy
    ? uniqueParts(['中国', ...administrativeParts])
    : uniqueParts([components.country ?? territory.country, ...administrativeParts]);

  await initRegionCache(mongo);
  let chain = isChinaHierarchy ? resolveRegionFromGeneral(general) : null;
  if (!chain && isChinaHierarchy) {
    const parsed = parseRegionChainFromText(
      reverse.results[0]?.formattedAddress ?? fallbackAddress ?? ''
    );
    chain = parsed?.chain ?? null;
  }

  let matchedBy: NearcadeRegionResolution['matchedBy'];
  if (!chain) {
    const countryId = isChinaHierarchy ? 'CN' : countryCode;
    const point = territory.normalizedInput;
    const nearest = await resolveRegionNearPoint(countryId, administrativeParts, [
      point.longitude,
      point.latitude
    ]);
    chain = nearest?.chain ?? null;
    matchedBy = nearest?.matchedBy;
  }

  const formattedAddress = reverse.results[0]?.formattedAddress ?? '';
  return {
    resolved: Boolean(countryCode),
    ...(chain?.length ? { chain } : { needsManualRegion: true }),
    general,
    detailed: formatDetailedAddress(
      formattedAddress,
      countryCode,
      formattedAdministrativeParts,
      components.country ?? territory.country,
      fallbackAddress
    ),
    ...(matchedBy ? { matchedBy } : {})
  };
}
