import {
  deriveGeneralAddress,
  expandRegionHierarchyLocalized,
  expandRegionHierarchyWithNames,
  isTerminalRegion,
  resolveRegionFromGeneral
} from '$lib/regions/utils.server';
import type { AddressRegionEntry } from '$lib/regions/types';
import { regionLabelIndexFromChain, type RegionLabelIndex } from '$lib/regions/labels';
import type { Shop, ShopApiAddress } from '$lib/types';
import { getLocale } from '$lib/paraglide/runtime';

export interface ResolvedShopAddress {
  general: string[];
  detailed: string;
  region: string[];
}

export class IncompleteShopRegionError extends Error {
  constructor() {
    super('Shop region information is incomplete. Please select a region.');
    this.name = 'IncompleteShopRegionError';
  }
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

  // 1. Region ID provided → expand to full hierarchy, derive general.
  if (region && region.length > 0) {
    const leafId = region[region.length - 1];
    try {
      const derived = await deriveGeneralAddress(leafId);
      if (
        derived.region.length > 0 &&
        !(await isTerminalRegion(derived.region[derived.region.length - 1]!))
      ) {
        throw new IncompleteShopRegionError();
      }
      return { general: derived.general, detailed, region: derived.region };
    } catch (error) {
      if (error instanceof IncompleteShopRegionError) throw error;
      // Expansion failed; fall through to try name-based resolution.
    }
  }

  // 2. No valid region IDs provided but general has values →
  //    attempt reverse lookup from general names.
  if (general.length > 0) {
    const resolved = resolveRegionFromGeneral(general);
    if (resolved && resolved.length > 0) {
      if (!(await isTerminalRegion(resolved[resolved.length - 1]!))) {
        throw new IncompleteShopRegionError();
      }
      return { general, detailed, region: resolved };
    }
    // Could not resolve — log a warning but preserve the general data.
    console.warn(
      `resolveShopAddress: could not resolve region IDs from general: [${general.join(', ')}]`
    );
  }

  // 3. Neither region nor general → return empty.
  return { general, detailed, region: [] };
}

/**
 * The one rule that keeps `address.general` and `address.region[].name` in
 * agreement: `general` IS the list of region names, root → leaf. Falls back to
 * the stored value for shops with no region chain.
 */
export const generalFromRegion = (
  region: AddressRegionEntry[],
  fallback: string[] = []
): string[] => (region.length > 0 ? region.map((entry) => entry.name) : fallback);

/**
 * Turn a stored shop address into its public form for `locale`.
 *
 * Databases keep only the region ID chain. The localized names are resolved
 * here, once, from that chain — and `general` is derived from the very same
 * names, so the two can never disagree and no shop carries N copies of its
 * region names. Shops with no region (legacy rows) fall back to the stored
 * `general`.
 */
export async function toShopApiAddress(
  address: { general?: string[]; detailed?: string; region?: string[] | AddressRegionEntry[] },
  locale: string = getLocale()
): Promise<ShopApiAddress> {
  const detailed = address.detailed ?? '';
  const storedRegion = address.region;

  const region: AddressRegionEntry[] =
    storedRegion && storedRegion.length > 0
      ? typeof storedRegion[0] === 'string'
        ? await expandRegionHierarchyLocalized(
            (storedRegion as string[])[(storedRegion as string[]).length - 1],
            locale
          )
        : (storedRegion as AddressRegionEntry[])
      : [];

  return { detailed, region, general: generalFromRegion(region, address.general ?? []) };
}

/**
 * Expand region IDs for a single shop's address into localized `{ id, name }`
 * entries and derive `address.general` from them.
 * Safe to call on shops whose region data is already expanded.
 */
export async function expandShopRegions<T extends { address?: Shop['address'] }>(
  shop: T
): Promise<T> {
  if (!shop.address) return shop;
  return { ...shop, address: await toShopApiAddress(shop.address) };
}

/**
 * Expand region IDs for an array of shops' addresses into localized
 * `{ id, name }` entries.
 * Safe to call on shops whose region data is already expanded.
 */
export async function expandShopsRegions<T extends { address?: Shop['address'] }>(
  shops: T[]
): Promise<T[]> {
  return Promise.all(shops.map((shop) => expandShopRegions(shop)));
}

/**
 * Localized display data for a set of region IDs, keyed by ID.
 *
 * The filter state is IDs-only, so every surface that renders a selected region
 * needs this or it shows raw IDs (`CN-310000`). Resolution is cheap (the region
 * hierarchy is cached in memory) and runs eagerly during page load so chips,
 * titles and drill-down breadcrumbs render with the page shell rather than
 * popping in.
 *
 * Every node of every requested chain is indexed, not just the leaves: the
 * globe's breadcrumb drills *up* a chain, and the filter panel can hold any
 * node of one as a selection. Sharing one index across both is what makes a
 * selection read identically everywhere it appears.
 *
 * An unknown or unreachable ID degrades to itself rather than throwing: a stale
 * shared link should still render a (labelless) chip instead of a 500.
 */
export async function buildRegionLabelIndex(
  regionIds: string[] | undefined,
  locale: string = getLocale()
): Promise<RegionLabelIndex> {
  const index: RegionLabelIndex = { labels: {}, chains: {} };
  for (const regionId of regionIds ?? []) {
    if (!regionId || index.labels[regionId]) continue;
    let chain: AddressRegionEntry[];
    try {
      chain = await expandRegionHierarchyLocalized(regionId, locale);
    } catch {
      chain = [];
    }
    if (chain.length === 0) {
      index.labels[regionId] = { name: regionId, path: '' };
      index.chains[regionId] = [{ id: regionId, name: regionId }];
      continue;
    }
    const resolved = regionLabelIndexFromChain(chain, locale);
    Object.assign(index.labels, resolved.labels);
    Object.assign(index.chains, resolved.chains);
  }
  return index;
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
