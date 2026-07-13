import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IPv4, IPv6, loadContentFromFile, newWithBuffer } from 'ip2region.js';
import type { Searcher } from 'ip2region.js';
import { extractLocaleFromRequest } from '$lib/paraglide/runtime';

function resolveXdbPath(name: string): string | null {
  const devPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'assets',
    'ip2region',
    name
  );
  if (existsSync(devPath)) return devPath;

  const prodPath = resolve(process.cwd(), 'data', 'ip2region', name);
  if (existsSync(prodPath)) return prodPath;

  return null;
}

const XDB_V4_PATH = resolveXdbPath('ip2region_v4.xdb');
const XDB_V6_PATH = resolveXdbPath('ip2region_v6.xdb');

type SupportedLocale = 'en' | 'zh' | 'ja';

export type ResolvedIpRegion = {
  ip: string;
  countryCode: string | null;
  countryName: string | null;
  regionName: string | null;
  city: string | null;
  isp: string | null;
  display: string | null;
};

const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);

let v4Searcher: Searcher | null = null;
let v6Searcher: Searcher | null = null;

function getSearcher(ip: string): Searcher | null {
  const isV6 = ip.includes(':');

  if (isV6) {
    if (!v6Searcher) {
      if (!XDB_V6_PATH) return null;
      try {
        const cBuffer = loadContentFromFile(XDB_V6_PATH);
        v6Searcher = newWithBuffer(IPv6, cBuffer);
      } catch (err) {
        console.error('[IPGL] Failed to load v6 xdb:', err);
        return null;
      }
    }
    return v6Searcher;
  }

  if (!v4Searcher) {
    if (!XDB_V4_PATH) return null;
    try {
      const cBuffer = loadContentFromFile(XDB_V4_PATH);
      v4Searcher = newWithBuffer(IPv4, cBuffer);
    } catch (err) {
      console.error('[IPGL] Failed to load v4 xdb:', err);
      return null;
    }
  }
  return v4Searcher;
}

function normalizeIp(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (value.includes(':') && !value.match(/^[0-9a-fA-F:]+$/)) return null;
  if (!value.includes(':') && !value.match(/^[0-9.]+$/)) return null;
  return value;
}

function parseXdbRegion(region: string): {
  country: string | null;
  province: string | null;
  city: string | null;
  isp: string | null;
  countryCode: string | null;
} {
  const parts = region.split('|');
  return {
    country: parts[0] || null,
    province: parts[1] || null,
    city: parts[2] || null,
    isp: parts[3] && parts[3] !== '0' ? parts[3] : null,
    countryCode: parts[4] || null
  };
}

function getCountryDisplayName(
  countryCode: string | null,
  fallbackCountryName: string | null
): string | null {
  if (!countryCode) return fallbackCountryName;
  return fallbackCountryName ?? countryCode;
}

function toDisplayName(
  data: {
    countryName: string | null;
    regionName: string | null;
    isp: string | null;
  },
  locale: SupportedLocale
): string | null {
  const locationParts = [data.countryName, data.regionName].filter(
    (value, index, array): value is string => !!value && array.indexOf(value) === index
  );

  const network = data.isp;
  const reverse = !(locale === 'zh' || locale === 'ja');

  if (network && locationParts.length > 0) {
    return `${reverse ? locationParts.toReversed().join(', ') : locationParts.join(' · ')} | ${network}`;
  }

  if (network) {
    return network;
  }

  const orderedParts = reverse ? locationParts.toReversed() : locationParts;
  return locationParts.length > 0 ? orderedParts.join(reverse ? ', ' : ' · ') : null;
}

export async function lookupIpRegion(
  ip: string,
  request: Request
): Promise<ResolvedIpRegion | null> {
  const normalizedIp = normalizeIp(ip);
  if (!normalizedIp) return null;

  const locale = getSupportedLocale(request);

  if (LOOPBACK_IPS.has(normalizedIp)) {
    return {
      ip: normalizedIp,
      countryCode: null,
      countryName: null,
      regionName: null,
      city: null,
      isp: null,
      display: null
    };
  }

  const searcher = getSearcher(normalizedIp);
  if (!searcher) {
    console.warn('[IPGL] xdb not available, skipping lookup for', normalizedIp);
    return null;
  }

  try {
    const region = await searcher.search(normalizedIp);
    if (!region) return null;

    const parsed = parseXdbRegion(region);
    const countryName = getCountryDisplayName(parsed.countryCode, parsed.country);

    const resolved: ResolvedIpRegion = {
      ip: normalizedIp,
      countryCode: parsed.countryCode,
      countryName,
      regionName: parsed.province,
      city: parsed.city,
      isp: parsed.isp,
      display: toDisplayName({ countryName, regionName: parsed.province, isp: parsed.isp }, locale)
    };

    return resolved;
  } catch (error) {
    console.error('[IPGL] Failed for IP', normalizedIp, error);
    return null;
  }
}

function getSupportedLocale(request: Request): SupportedLocale {
  const locale = extractLocaleFromRequest(request);
  return locale === 'zh' || locale === 'ja' ? locale : 'en';
}
