/**
 * ── Region Hierarchy Server Utilities ──────────────────────────────────────
 * Loads the globe-cn region collection from MongoDB, builds in-memory
 * lookup maps, and exposes selection/hierarchy/formatting helpers.
 *
 * **Initialisation**: Call `initRegionCache(client)` once before using any
 * public function. The returned promise is stored internally; public
 * functions await it if init is still in-flight.
 */
import type { MongoClient } from 'mongodb';
import mongo from '$lib/db/index.server';
import type { Region, AddressRegionEntry, AdminRegionNode, AdminRegionSearchHit } from './types';

// ── Cached data ────────────────────────────────────────────────────────────

let byId: Map<string, Region> | null = null;
let childrenByParentId: Map<string | null, Region[]> | null = null;
let byName: Map<string, Region> | null = null;

let countryMachineCounts: { map: Map<string, number>; fetchedAt: number } | null = null;
const COUNTRY_MACHINES_CACHE_TTL_MS = 60 * 60 * 1000;

// ── Loading ────────────────────────────────────────────────────────────────

export async function initRegionCache(client: MongoClient) {
  if (byId) return;

  const db = client.db();
  const raw = await db
    .collection<Region>('regions')
    .find({})
    .project<Region>({
      id: 1,
      parentId: 1,
      level: 1,
      name: 1,
      population: 1,
      area: 1,
      location: 1,
      _settlementType: 1,
      _adminType: 1
    })
    .toArray();

  byId = new Map(raw.map((r) => [r.id, r]));

  childrenByParentId = new Map<string | null, Region[]>();
  byName = new Map();
  for (const region of raw) {
    const key = region.parentId;
    const bucket = childrenByParentId.get(key);
    if (bucket) {
      bucket.push(region);
    } else {
      childrenByParentId.set(key, [region]);
    }

    // Build reverse lookup keyed by (parentId, level, zh-name).
    // Use the zh name as the canonical key since address.general stores
    // Chinese names for Chinese regions.
    const zhName = region.name.zh;
    if (zhName) {
      const nameKey = `${region.parentId ?? '__root__'}\0${region.level}\0${zhName}`;
      byName.set(nameKey, region);
    }
  }

  console.log('[Region Cache] Loaded', byId.size, 'regions');
}

export async function reloadRegionCache(client: MongoClient): Promise<void> {
  byId = null;
  childrenByParentId = null;
  byName = null;
  await initRegionCache(client);
}

// ── Selector logic ─────────────────────────────────────────────────────────

/**
 * Pick the best name for a locale from a region's name map.
 * Priority: exact locale match → language match → English → any available value.
 */
function selectRegionNameForLocale(name: Record<string, string>, locale: string): string {
  if (name[locale]) return name[locale];
  const language = locale.split('-')[0];
  if (language && name[language]) return name[language];
  if (name.en) return name.en;
  const firstAvailable = Object.values(name).find((value) => value);
  return firstAvailable ?? '';
}

function compareRegions(a: Region, b: Region, collator: Intl.Collator, locale: string): number {
  const order: Record<Region['level'], number> = {
    country: 0,
    province: 1,
    city: 2,
    county: 3,
    street: 4
  };
  const d = order[a.level] - order[b.level];
  if (d !== 0) return d;
  if (a.level === 'city') {
    const pop = (b.population ?? -1) - (a.population ?? -1);
    if (pop !== 0) return pop;
  }
  const labelA = selectRegionNameForLocale(a.name, locale);
  const labelB = selectRegionNameForLocale(b.name, locale);
  return collator.compare(labelA, labelB);
}

function selectRegions(candidates: Region[], locale: string): Region[] {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  return candidates
    .filter(
      (r) =>
        r.level === 'country' ||
        r.level === 'province' ||
        r.level === 'city' ||
        r.level === 'county' ||
        r.level === 'street'
    )
    .sort((a, b) => compareRegions(a, b, collator, locale));
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function getRegionById(id: string): Promise<Region | undefined> {
  return byId?.get(id);
}

export async function expandRegionHierarchy(leafId: string): Promise<string[]> {
  const path: string[] = [];
  let cur: Region | undefined = byId?.get(leafId);
  while (cur) {
    path.unshift(cur.id);
    cur = cur.parentId ? byId?.get(cur.parentId) : undefined;
  }
  return path;
}

export async function expandRegionHierarchyWithNames(
  leafId: string
): Promise<AddressRegionEntry[]> {
  const entries: AddressRegionEntry[] = [];
  let cur: Region | undefined = byId?.get(leafId);
  while (cur) {
    entries.unshift({ id: cur.id, name: cur.name });
    cur = cur.parentId ? byId?.get(cur.parentId) : undefined;
  }
  return entries;
}

export async function deriveGeneralAddress(
  leafId: string
): Promise<{ general: string[]; region: string[] }> {
  const entries = await expandRegionHierarchyWithNames(leafId);
  const isChina = entries.length > 0 && entries[0].id === 'CN';
  const general = entries.map((e) => (isChina ? (e.name.zh ?? e.name.en) : e.name.en) ?? e.id);
  return { general, region: entries.map((e) => e.id) };
}

/** Whether a region has no selectable descendants. */
export async function isTerminalRegion(id: string): Promise<boolean> {
  return byId?.has(id) === true && !(childrenByParentId?.has(id) ?? false);
}

/**
 * Attempt to resolve region IDs from a `general` address array (e.g.
 * `["中国", "黑龙江省", "齐齐哈尔市", "龙沙区"]`) by matching names
 * bottom-up against the in-memory region cache.
 *
 * Matches each name against the children of the previously resolved parent,
 * trying each remaining administrative level in order (country → province →
 * city → county).  This handles variable-length `general` arrays caused by
 * direct-administered municipalities (e.g. `["中国", "重庆市", "沙坪坝区"]`).
 *
 * Returns the region ID hierarchy on success, or `null` if any level
 * could not be resolved unambiguously.
 */
export function resolveRegionFromGeneral(general: string[]): string[] | null {
  if (!byName || general.length === 0) return null;

  const levels: Region['level'][] = ['country', 'province', 'city', 'county', 'street'];

  const resolved: string[] = [];
  let parentId: string | null = null;
  let levelCursor = 0; // index into `levels` for the NEXT expected level

  for (const name of general) {
    let matched: Region | undefined;

    // Try each remaining level at the current parent.
    for (let offset = 0; levelCursor + offset < levels.length; offset++) {
      const candidateLevel = levels[levelCursor + offset];
      const key = `${parentId ?? '__root__'}\0${candidateLevel}\0${name}`;
      const candidate = byName.get(key);
      if (candidate) {
        matched = candidate;
        levelCursor = levelCursor + offset + 1; // advance past the matched level
        break;
      }
    }

    if (!matched) return null;

    resolved.push(matched.id);
    parentId = matched.id;
  }

  return resolved;
}
/**
 * Load the total machine count per country from the `region_rankings`
 * collection so top-level selector options can be ordered by arcade
 * presence rather than alphabetically. Countries without a ranking entry
 * (i.e. no machines) fall through to alphabetical order at the end.
 */
export async function getCountryMachineCounts(): Promise<Map<string, number>> {
  if (
    countryMachineCounts &&
    Date.now() - countryMachineCounts.fetchedAt < COUNTRY_MACHINES_CACHE_TTL_MS
  ) {
    return countryMachineCounts.map;
  }
  try {
    const docs = (await mongo
      .db()
      .collection('region_rankings')
      .find({ level: 'country' } as never)
      .project({ _id: 1, totalMachines: 1 } as never)
      .toArray()) as Array<{ _id: string; totalMachines?: number }>;

    const map = new Map<string, number>();
    for (const doc of docs) {
      map.set(doc._id, typeof doc.totalMachines === 'number' ? doc.totalMachines : 0);
    }
    countryMachineCounts = { map, fetchedAt: Date.now() };
    return map;
  } catch (err) {
    console.error('Failed to load country machine counts:', err);
    return countryMachineCounts?.map ?? new Map<string, number>();
  }
}

async function orderCountriesByMachines<T extends { id: string; label: string }>(
  options: T[],
  locale: string
): Promise<T[]> {
  const machineCounts = await getCountryMachineCounts();
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  return [...options].sort((a, b) => {
    const ma = machineCounts.get(a.id) ?? -1;
    const mb = machineCounts.get(b.id) ?? -1;
    if (mb !== ma) return mb - ma;
    return collator.compare(a.label, b.label);
  });
}

export async function getSelectorChildren(
  parentId: string | null,
  locale: string
): Promise<Region[]> {
  const bucket = childrenByParentId?.get(parentId);
  if (!bucket || bucket.length === 0 || !byId) return [];
  return selectRegions(bucket, locale);
}

export async function getSelectorOptions(
  parentId: string | null,
  locale: string
): Promise<{ id: string; label: string; value: string; hasChildren: boolean }[]> {
  const children = await getSelectorChildren(parentId, locale);
  const options = children.map((child) => {
    const label = selectRegionNameForLocale(child.name, locale);
    return {
      id: child.id,
      label: label || child.id,
      value: child.id,
      hasChildren: childrenByParentId?.has(child.id) ?? false
    };
  });

  // Top-level (country) options are ordered by machine count so relevant
  // countries float to the top instead of being buried alphabetically.
  if (!parentId) {
    return orderCountriesByMachines(options, locale);
  }

  return options;
}

// Admin tree helpers

function toAdminRegionNode(region: Region): AdminRegionNode {
  return {
    id: region.id,
    parentId: region.parentId,
    level: region.level,
    name: region.name,
    population: region.population,
    area: region.area,
    location: region.location,
    hasChildren: childrenByParentId?.has(region.id) ?? false
  };
}

/**
 * Return the immediate children of a region (or top-level countries when
 * `parentId` is null) with full details and a `hasChildren` flag. Results are
 * sorted by region ID for a stable admin tree ordering.
 */
export function getAdminRegionChildren(parentId: string | null): AdminRegionNode[] {
  const bucket = childrenByParentId?.get(parentId) ?? [];
  return bucket.map((region) => toAdminRegionNode(region)).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Search every cached region by ID or localized name, returning matches with
 * their ancestor chain (root → parent) so the admin UI can render each hit in
 * context without loading the whole tree.
 */
export function searchAdminRegions(query: string, limit = 200): AdminRegionSearchHit[] {
  if (!byId) return [];
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const hits: AdminRegionSearchHit[] = [];
  for (const region of byId.values()) {
    if (hits.length >= limit) break;
    const matches =
      region.id.toLowerCase().includes(q) ||
      Object.values(region.name).some((name) => name?.toLowerCase().includes(q));
    if (!matches) continue;

    const ancestors: AddressRegionEntry[] = [];
    let cursor = region.parentId ? byId.get(region.parentId) : undefined;
    while (cursor) {
      ancestors.unshift({ id: cursor.id, name: cursor.name });
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }

    hits.push({ ...toAdminRegionNode(region), ancestors });
  }
  return hits;
}

/**
 * Given one or more region IDs, expand to the full hierarchy (root → leaf)
 * by walking up from the deepest ID. Returns each level's region data along
 * with the selector options (siblings) at that level.
 *
 * Examples:
 *   /api/regions/MX:71666       → expands to [MX, MX:71666]
 *   /api/regions/MX/MX:71666    → already full path, used as-is
 */
export async function getRegionHierarchyByIds(
  ids: string[],
  locale: string
): Promise<{
  levels: {
    region: { id: string; label: string; level: string; hasChildren: boolean };
    options: { id: string; label: string; value: string; hasChildren: boolean }[];
  }[];
} | null> {
  if (!byId || !childrenByParentId || ids.length === 0) return null;

  // Use the last ID as the target and walk up to build the full path.
  const leafId = ids[ids.length - 1];
  if (!byId.get(leafId)) return null;

  const fullPath: string[] = [];
  let cur: Region | undefined = byId.get(leafId);
  while (cur) {
    fullPath.unshift(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }

  const levels: {
    region: { id: string; label: string; level: string; hasChildren: boolean };
    options: { id: string; label: string; value: string; hasChildren: boolean }[];
  }[] = [];

  for (const id of fullPath) {
    const region = byId.get(id)!;

    // Get sibling options (children of this region's parent).
    const siblings = childrenByParentId.get(region.parentId) ?? [];
    let options = selectRegions(siblings, locale).map((s) => ({
      id: s.id,
      label: selectRegionNameForLocale(s.name, locale) || s.id,
      value: s.id,
      hasChildren: childrenByParentId?.has(s.id) ?? false
    }));

    // Country-level sibling options follow the same machine-count ordering.
    if (!region.parentId) {
      options = await orderCountriesByMachines(options, locale);
    }

    levels.push({
      region: {
        id: region.id,
        label: selectRegionNameForLocale(region.name, locale) || region.id,
        level: region.level,
        hasChildren: childrenByParentId?.has(region.id) ?? false
      },
      options
    });
  }

  return { levels };
}
