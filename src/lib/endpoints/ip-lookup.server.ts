import { extractLocaleFromRequest } from '$lib/paraglide/runtime';

type SupportedLocale = 'en' | 'zh' | 'ja';

type IpApiResponse = {
  status: 'success' | 'fail';
  message?: string;
  query?: string;
  country?: string;
  countryCode?: string;
  region?: string;
  regionName?: string;
  city?: string;
  district?: string;
  zip?: string;
  lat?: number;
  lon?: number;
  timezone?: string;
  isp?: string;
  org?: string;
  as?: string;
};

export type ResolvedIpRegion = {
  ip: string;
  countryCode: string | null;
  countryName: string | null;
  regionName: string | null;
  city: string | null;
  district: string | null;
  isp: string | null;
  organization: string | null;
  asn: string | null;
  display: string | null;
};

const CHINA_RELATED_COUNTRY_NAME_OVERRIDES: Record<
  string,
  Partial<Record<SupportedLocale, string>>
> = {
  CN: {
    en: 'China',
    zh: '中国',
    ja: '中国'
  },
  HK: {
    en: 'Hong Kong, China',
    zh: '中国香港',
    ja: '中国香港'
  },
  MO: {
    en: 'Macao, China',
    zh: '中国澳门',
    ja: '中国マカオ'
  },
  TW: {
    en: 'Taiwan, China',
    zh: '中国台湾',
    ja: '中国台湾'
  }
};

const IP_API_FIELDS = [
  'status',
  'message',
  'query',
  'country',
  'countryCode',
  'regionName',
  'city',
  'district',
  'isp',
  'org',
  'as'
].join(',');

const ipLookupCache = new Map<string, { expiresAt: number; value: ResolvedIpRegion | null }>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 12;

function getSupportedLocale(request: Request): SupportedLocale {
  const locale = extractLocaleFromRequest(request);
  return locale === 'zh' || locale === 'ja' ? locale : 'en';
}

function normalizeIp(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  return value;
}

function getCountryDisplayName(
  countryCode: string | undefined,
  fallbackCountryName: string | undefined,
  locale: SupportedLocale
): string | null {
  if (!countryCode) return fallbackCountryName ?? null;
  const override = CHINA_RELATED_COUNTRY_NAME_OVERRIDES[countryCode]?.[locale];
  return override ?? fallbackCountryName ?? countryCode;
}

function toDisplayName(data: {
  countryName: string | null;
  regionName: string | null;
  city: string | null;
  district: string | null;
  isp: string | null;
  organization: string | null;
}): string | null {
  const locationParts = [data.countryName, data.regionName, data.city, data.district].filter(
    (value, index, array): value is string => !!value && array.indexOf(value) === index
  );

  const network = data.isp || data.organization;
  if (network && locationParts.length > 0) {
    return `${locationParts.join(' · ')} · ${network}`;
  }

  if (network) {
    return network;
  }

  return locationParts.length > 0 ? locationParts.join(' · ') : null;
}

export async function lookupIpRegion(
  ip: string,
  request: Request
): Promise<ResolvedIpRegion | null> {
  const normalizedIp = normalizeIp(ip);
  if (!normalizedIp) return null;

  const locale = getSupportedLocale(request);
  const cacheKey = `${locale}:${normalizedIp}`;
  const cached = ipLookupCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  try {
    const url = new URL(`http://ip-api.com/json/${encodeURIComponent(normalizedIp)}`);
    url.searchParams.set('lang', locale === 'zh' ? 'zh-CN' : locale);
    url.searchParams.set('fields', IP_API_FIELDS);

    const response = await fetch(url, {
      headers: {
        accept: 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`ip-api HTTP ${response.status}`);
    }

    const data = (await response.json()) as IpApiResponse;
    if (data.status !== 'success') {
      throw new Error(data.message ?? 'ip-api lookup failed');
    }

    const resolved: ResolvedIpRegion = {
      ip: data.query ?? normalizedIp,
      countryCode: data.countryCode ?? null,
      countryName: getCountryDisplayName(data.countryCode, data.country, locale),
      regionName: data.regionName ?? null,
      city: data.city ?? null,
      district: data.district ?? null,
      isp: data.isp ?? null,
      organization: data.org ?? null,
      asn: data.as ?? null,
      display: null
    };

    resolved.display = toDisplayName(resolved);
    ipLookupCache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      value: resolved
    });
    return resolved;
  } catch (error) {
    console.error('[ip-lookup] failed for ip', normalizedIp, error);
    ipLookupCache.set(cacheKey, {
      expiresAt: Date.now() + 1000 * 60,
      value: null
    });
    return null;
  }
}
