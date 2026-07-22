// ── Global region hierarchy types ───────────────────────────────────────────
// Mirrors the production schema emitted by the globe-cn pipeline and stored
// in the MongoDB `regions` collection.

export type RegionLevel = 'country' | 'province' | 'city' | 'county';

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
  ancestors: AddressRegionEntry[];
}

/** Public shape of an address region entry returned from API responses. */
export interface AddressRegionEntry {
  id: string;
  name: Record<string, string>;
}

export interface ShopAddressRegionInput {
  /** Leaf region ID selected by the client; the server expands it to a hierarchy. */
  region?: string[];
}
