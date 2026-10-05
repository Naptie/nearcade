// ── Global region hierarchy types ───────────────────────────────────────────
// Mirrors the production schema emitted by the globe-cn pipeline and stored
// in the MongoDB `regions` collection.

export type RegionLevel = 'country' | 'province' | 'city' | 'county' | 'street';

export interface GeoPoint {
  type: 'Point';
  coordinates: [number, number]; // [longitude, latitude]
}

export interface Region {
  _id?: string;
  id: string;
  parentId: string | null;
  level: RegionLevel;
  /** Locale-keyed display names. `en` is always present. */
  name: Record<string, string>;
  population: number | null;
  area: number | null;
  location: GeoPoint | null;
  /** Pipeline-only field used to decide selectability. */
  _settlementType?: string;
  /** Pipeline-only administrative type. */
  _adminType?: string;
  /** Upstream selection guard: false = hidden from the region selector. */
  selectable?: false;
  /** Stable Wikidata entity selected during enrichment. */
  _wikidataQid?: string;
}

/** Locale-aware display option exposed by the region selector API. */
export interface RegionSelectorOption {
  id: string;
  value: string;
  label: string;
  hasChildren: boolean;
}

/**
 * Admin-facing region node: full region details plus whether it has children,
 * so the admin tree can lazily expand one level at a time.
 */
export interface AdminRegionNode {
  id: string;
  parentId: string | null;
  level: RegionLevel;
  name: Record<string, string>;
  population: number | null;
  area: number | null;
  location: GeoPoint | null;
  hasChildren: boolean;
}

/** Admin region search hit: a node plus its ancestor chain from the root. */
export interface AdminRegionSearchHit extends AdminRegionNode {
  ancestors: RegionNameEntry[];
}

/**
 * A hierarchy node carrying every locale's name. Internal only: the region
 * cache, hierarchy expansion, admin trees, and the Meilisearch index all need
 * the full multilingual map. Public responses must NOT ship this — see
 * {@link AddressRegionEntry}.
 */
export interface RegionNameEntry {
  id: string;
  name: Record<string, string>;
}

/**
 * Public shape of an address region entry: the stable region ID plus the one
 * localized name the request asked for. Databases store only the ID chain; the
 * name is resolved at read time for the caller's locale.
 */
export interface AddressRegionEntry {
  id: string;
  name: string;
}

export interface ShopAddressRegionInput {
  /** Leaf region ID selected by the client; the server expands it to a hierarchy. */
  region?: string[];
}

/**
 * Display label for a selected region node: the node's own localized name plus
 * its ancestor path, already formatted for the locale via `formatAddressParts`.
 * e.g. locale "en", node "Shanghai" under "China" → { name: "Shanghai", path: "China" };
 * locale "zh" → { name: "上海", path: "中国" }.
 */
export interface RegionDisplayLabel {
  /** Localized name of the node itself — the primary chip label. */
  name: string;
  /** Formatted localized ancestor path, root → parent ('' for a top-level node). */
  path: string;
}
