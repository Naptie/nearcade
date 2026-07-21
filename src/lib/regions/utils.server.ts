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
import type { Region, AddressRegionEntry } from './types';

// ── Cached data ────────────────────────────────────────────────────────────

let byId: Map<string, Region> | null = null;
let childrenByParentId: Map<string | null, Region[]> | null = null;

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
  for (const region of raw) {
    const key = region.parentId;
    const bucket = childrenByParentId.get(key);
    if (bucket) {
      bucket.push(region);
    } else {
      childrenByParentId.set(key, [region]);
    }
  }
}

export async function reloadRegionCache(client: MongoClient): Promise<void> {
  byId = null;
  childrenByParentId = null;
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
    county: 3
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
        r.level === 'county'
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
  return children.map((child) => {
    const label = selectRegionNameForLocale(child.name, locale);
    return {
      id: child.id,
      label: label || child.id,
      value: child.id,
      hasChildren: childrenByParentId?.has(child.id) ?? false
    };
  });
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
export function getRegionHierarchyByIds(
  ids: string[],
  locale: string
): {
  levels: {
    region: { id: string; label: string; level: string; hasChildren: boolean };
    options: { id: string; label: string; value: string; hasChildren: boolean }[];
  }[];
} | null {
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
    const options = selectRegions(siblings, locale).map((s) => ({
      id: s.id,
      label: selectRegionNameForLocale(s.name, locale) || s.id,
      value: s.id,
      hasChildren: childrenByParentId?.has(s.id) ?? false
    }));

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
