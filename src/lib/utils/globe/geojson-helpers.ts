// Pure geometry / data-transformation utilities shared by geojson.ts and
// the country-level normalizers living in src/lib/countries/.  This file
// must NOT import from either of those modules so that both can import from
// here without introducing a circular dependency.

type Geometry = GeoJSON.Geometry;
type GeoJsonProperties = GeoJSON.GeoJsonProperties;
type Position = GeoJSON.Position;

export type RawGlobeFeature = GeoJSON.Feature<Geometry, GeoJsonProperties>;
export type RawGlobeFeatureCollection = GeoJSON.FeatureCollection<Geometry, GeoJsonProperties>;
export type PolygonGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon;

export type GlobeFeatureLevel = 'world' | 'province' | 'city' | 'district' | 'county';

export type GlobeFeatureProperties = {
  dataset: string;
  featureId: string;
  name: string;
  label: string;
  level: GlobeFeatureLevel;
  adcode?: string;
  parentAdcode?: string;
  provinceAdcode?: string;
  cityPrefix?: string;
  numericCode?: string;
  region?: string;
  subregion?: string;
  isChina?: boolean;
  supportedCountryNumericCode?: string;
  hasCountyChildren?: boolean;
};

export type GlobeFeature = GeoJSON.Feature<Geometry, GlobeFeatureProperties>;
export type GlobeFeatureCollection = GeoJSON.FeatureCollection<Geometry, GlobeFeatureProperties>;

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

export const toStringValue = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
};

export const getNestedAdcode = (value: unknown): string | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return toStringValue((value as { adcode?: unknown }).adcode);
};

export const asLevel = (value: unknown): GlobeFeatureLevel | undefined => {
  if (
    value === 'world' ||
    value === 'province' ||
    value === 'city' ||
    value === 'district' ||
    value === 'county'
  )
    return value;
  return undefined;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const toPosition = (value: unknown): Position | undefined => {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const [lng, lat, ...rest] = value;
  if (!isFiniteNumber(lng) || !isFiniteNumber(lat)) return undefined;
  const altitude = rest.find((e) => isFiniteNumber(e));
  return typeof altitude === 'number' ? [lng, lat, altitude] : [lng, lat];
};

const normalizeRing = (value: unknown): Position[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const ring = value.flatMap((e) => {
    const p = toPosition(e);
    return p ? [p] : [];
  });
  return ring.length >= 4 ? ring : undefined;
};

const normalizePolygonCoordinates = (value: unknown): Position[][] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const rings = value.flatMap((e) => {
    const r = normalizeRing(e);
    return r ? [r] : [];
  });
  return rings.length > 0 ? rings : undefined;
};

export const normalizePolygonGeometry = (
  geometry: Geometry | null | undefined
): PolygonGeometry | undefined => {
  if (!geometry) return undefined;

  if (geometry.type === 'Polygon') {
    const coordinates = normalizePolygonCoordinates(geometry.coordinates);
    if (!coordinates) return undefined;
    return { type: 'Polygon', coordinates };
  }

  if (geometry.type === 'MultiPolygon') {
    if (!Array.isArray(geometry.coordinates)) return undefined;
    const coordinates = geometry.coordinates.flatMap((pc) => {
      const polygon = normalizePolygonCoordinates(pc);
      return polygon ? [polygon] : [];
    });
    if (coordinates.length === 0) return undefined;
    return { type: 'MultiPolygon', coordinates };
  }

  if (geometry.type === 'GeometryCollection') {
    const multiPolygonCoordinates = geometry.geometries.flatMap((e) => {
      const n = normalizePolygonGeometry(e);
      if (!n) return [];
      return n.type === 'Polygon' ? [n.coordinates] : n.coordinates;
    });
    if (multiPolygonCoordinates.length === 0) return undefined;
    return { type: 'MultiPolygon', coordinates: multiPolygonCoordinates };
  }

  return undefined;
};

export const emptyGlobeFeatureCollection = (): GlobeFeatureCollection => ({
  type: 'FeatureCollection',
  features: []
});

// ---------------------------------------------------------------------------
// Bounds helper
// ---------------------------------------------------------------------------

const pushPositions = (value: unknown, positions: Position[]) => {
  if (!Array.isArray(value) || value.length === 0) return;
  if (typeof value[0] === 'number' && typeof value[1] === 'number') {
    positions.push([value[0], value[1]]);
    return;
  }
  for (const v of value) pushPositions(v, positions);
};

export const getFeatureBounds = (feature: GlobeFeature | null | undefined) => {
  if (!feature?.geometry) return null;

  const positions: Position[] = [];
  if (feature.geometry.type === 'GeometryCollection') {
    for (const g of feature.geometry.geometries) {
      if (g.type !== 'GeometryCollection') pushPositions(g.coordinates, positions);
    }
  } else {
    pushPositions(feature.geometry.coordinates, positions);
  }

  if (positions.length === 0) return null;

  let [minLng, maxLng] = [positions[0][0], positions[0][0]];
  let [minLat, maxLat] = [positions[0][1], positions[0][1]];

  for (const [lng, lat] of positions) {
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }

  return [
    [minLng, minLat],
    [maxLng, maxLat]
  ] as [[number, number], [number, number]];
};
