import { deriveGeneralAddress, expandRegionHierarchyWithNames } from '$lib/regions/utils.server';
import type { AddressRegionEntry } from '$lib/regions/types';
import type { Shop } from '$lib/types';
import { getLocale } from '$lib/paraglide/runtime';

export interface ResolvedShopAddress {
  general: string[];
  detailed: string;
  region: string[];
}

/**
 * Resolve a shop address for storage.  Accepts the client-supplied shape
 * (general + region leaf hint) and returns the canonical stored form.
 *
 * Priority:
 * 1. If `region` (a leaf ID) is provided → expand to full hierarchy, derive `general`.
 * 2. If only `general` is provided → resolve via name matching.
 * 3. Otherwise → return as-is (empty).
 */
export async function resolveShopAddress(input: {
  general: string[];
  detailed: string;
  region?: string[];
  coordinates?: [number, number] | null;
}): Promise<ResolvedShopAddress> {
  const { general, detailed, region } = input;
  if (region && region.length > 0) {
    const leafId = region[region.length - 1];
    const derived = await deriveGeneralAddress(leafId);
    return { general: derived.general, detailed, region: derived.region };
  }
  return { general, detailed, region: [] };
}

/**
 * Expand stored region IDs to full `{id, name}` entries for API responses.
 * If no region IDs are stored, returns an empty array.
 */
export async function expandShopAddress(
  region: string[] | undefined
): Promise<AddressRegionEntry[]> {
  if (!region || region.length === 0) return [];

  const leafId = region[region.length - 1];

  try {
    return await expandRegionHierarchyWithNames(leafId);
  } catch {
    return [];
  }
}

function isRegionIdArray(region: Shop['address']['region']): region is string[] {
  return Array.isArray(region) && region.length > 0 && typeof region[0] === 'string';
}

/**
 * Expand region IDs for a single shop's address into `{id, name}` entries
 * and localize `address.general` using the user's locale.
 * Safe to call on shops whose region data is already expanded.
 */
export async function expandShopRegions<T extends { address?: Shop['address'] }>(
  shop: T
): Promise<T> {
  const region = shop.address?.region;
  if (!isRegionIdArray(region)) {
    // Already expanded or no region data — still localize general if region objects exist
    if (shop.address && region && region.length > 0 && typeof region[0] === 'object') {
      return {
        ...shop,
        address: {
          ...shop.address,
          general: localizeAddressGeneral({
            general: shop.address.general ?? [],
            region
          })
        }
      };
    }
    return shop;
  }

  const expanded = await expandShopAddress(region);
  const localizedAddress = { general: shop.address?.general ?? [], region: expanded };
  return {
    ...shop,
    address: {
      ...shop.address,
      ...localizedAddress,
      general: localizeAddressGeneral(localizedAddress)
    }
  };
}

/**
 * Expand region IDs for an array of shops' addresses into `{id, name}` entries.
 * Safe to call on shops whose region data is already expanded.
 */
export async function expandShopsRegions<T extends { address?: Shop['address'] }>(
  shops: T[]
): Promise<T[]> {
  return Promise.all(shops.map((shop) => expandShopRegions(shop)));
}

/**
 * Pick the best name for a locale from a region's name map.
 * Priority: exact locale → language code → English → any available value.
 */
function selectLocalizedName(name: Record<string, string>, locale: string): string {
  if (name[locale]) return name[locale];
  const language = locale.split('-')[0];
  if (language && name[language]) return name[language];
  if (name.en) return name.en;
  const firstAvailable = Object.values(name).find((value) => value);
  return firstAvailable ?? '';
}

/**
 * Compute localized `address.general` from expanded region entries.
 * Falls back to the original `address.general` when region data is unavailable.
 */
export function localizeAddressGeneral(
  address: {
    general: string[];
    region?: string[] | AddressRegionEntry[];
  },
  locale: string = getLocale()
): string[] {
  const regions = address.region;
  if (regions && regions.length > 0 && typeof regions[0] === 'object') {
    const entries = regions as AddressRegionEntry[];
    return entries.map((entry) => selectLocalizedName(entry.name, locale));
  }
  return address.general;
}

/**
 * Collect ALL language variants of region names for a shop's region hierarchy.
 * Used to build the `regionNames` field for Meilisearch indexing so that
 * shops can be found by region name in any language.
 */
export async function getShopRegionNames(region: string[] | undefined): Promise<string[]> {
  if (!region || region.length === 0) return [];
  const leafId = region[region.length - 1];
  try {
    const entries = await expandRegionHierarchyWithNames(leafId);
    const names: string[] = [];
    for (const entry of entries) {
      for (const value of Object.values(entry.name)) {
        if (value && !names.includes(value)) {
          names.push(value);
        }
      }
    }
    return names;
  } catch {
    return [];
  }
}
