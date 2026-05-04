import { getSupportedCountry, type SupportedCountry } from '$lib/countries';

export type GlobeDataset = 'world' | 'china-provinces' | 'china-cities' | 'china-counties';
export type GlobeFeatureLevel = 'world' | 'province' | 'city' | 'district' | 'county';

export type GlobeFeatureProperties = {
  dataset: GlobeDataset;
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

type Geometry = GeoJSON.Geometry;
type GeoJsonProperties = GeoJSON.GeoJsonProperties;
type Position = GeoJSON.Position;
type RawGlobeFeature = GeoJSON.Feature<Geometry, GeoJsonProperties>;
type PolygonGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon;

export type GlobeFeature = GeoJSON.Feature<Geometry, GlobeFeatureProperties>;
export type GlobeFeatureCollection = GeoJSON.FeatureCollection<Geometry, GlobeFeatureProperties>;
export type RawGlobeFeatureCollection = GeoJSON.FeatureCollection<Geometry, GeoJsonProperties>;

const EMPTY_GLOBE_FEATURE_COLLECTION: GlobeFeatureCollection = {
  type: 'FeatureCollection',
  features: []
};

const toStringValue = (value: unknown) => {
  if (typeof value === 'string') {
    return value.trim() || undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
};

const getNestedAdcode = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return toStringValue((value as { adcode?: unknown }).adcode);
};

const asLevel = (value: unknown): GlobeFeatureLevel | undefined => {
  if (
    value === 'world' ||
    value === 'province' ||
    value === 'city' ||
    value === 'district' ||
    value === 'county'
  ) {
    return value;
  }

  return undefined;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const toPosition = (value: unknown): Position | undefined => {
  if (!Array.isArray(value) || value.length < 2) {
    return undefined;
  }

  const [lng, lat, ...rest] = value;

  if (!isFiniteNumber(lng) || !isFiniteNumber(lat)) {
    return undefined;
  }

  const altitude = rest.find((entry) => isFiniteNumber(entry));

  if (typeof altitude === 'number') {
    return [lng, lat, altitude];
  }

  return [lng, lat];
};

const normalizeRing = (value: unknown): Position[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const ring = value.flatMap((entry) => {
    const position = toPosition(entry);
    return position ? [position] : [];
  });

  return ring.length >= 4 ? ring : undefined;
};

const normalizePolygonCoordinates = (value: unknown): Position[][] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const rings = value.flatMap((entry) => {
    const ring = normalizeRing(entry);
    return ring ? [ring] : [];
  });

  return rings.length > 0 ? rings : undefined;
};

const normalizePolygonGeometry = (
  geometry: Geometry | null | undefined
): PolygonGeometry | undefined => {
  if (!geometry) {
    return undefined;
  }

  if (geometry.type === 'Polygon') {
    const coordinates = normalizePolygonCoordinates(geometry.coordinates);

    if (!coordinates) {
      return undefined;
    }

    return {
      type: 'Polygon',
      coordinates
    };
  }

  if (geometry.type === 'MultiPolygon') {
    if (!Array.isArray(geometry.coordinates)) {
      return undefined;
    }

    const coordinates = geometry.coordinates.flatMap((polygonCoordinates) => {
      const polygon = normalizePolygonCoordinates(polygonCoordinates);
      return polygon ? [polygon] : [];
    });

    if (coordinates.length === 0) {
      return undefined;
    }

    return {
      type: 'MultiPolygon',
      coordinates
    };
  }

  if (geometry.type === 'GeometryCollection') {
    const multiPolygonCoordinates = geometry.geometries.flatMap((entry) => {
      const normalized = normalizePolygonGeometry(entry);

      if (!normalized) {
        return [];
      }

      return normalized.type === 'Polygon' ? [normalized.coordinates] : normalized.coordinates;
    });

    if (multiPolygonCoordinates.length === 0) {
      return undefined;
    }

    return {
      type: 'MultiPolygon',
      coordinates: multiPolygonCoordinates
    };
  }

  return undefined;
};

export const emptyGlobeFeatureCollection = (): GlobeFeatureCollection => ({
  type: 'FeatureCollection',
  features: []
});

export const normalizeWorldGeoJson = (data: RawGlobeFeatureCollection): GlobeFeatureCollection => ({
  type: 'FeatureCollection',
  features: data.features.flatMap((feature: RawGlobeFeature, index: number) => {
    const geometry = normalizePolygonGeometry(feature.geometry);

    if (!geometry) {
      return [];
    }

    const properties = feature.properties ?? {};
    const name = toStringValue(properties.name);

    if (!name) {
      return [];
    }

    const numericCode = toStringValue(properties.numericCode);

    return [
      {
        type: 'Feature',
        geometry,
        properties: {
          dataset: 'world',
          featureId: `world:${numericCode ?? name}:${index}`,
          name,
          label: name,
          level: 'world',
          numericCode,
          region: toStringValue(properties.region),
          subregion: toStringValue(properties.subregion),
          isChina: name === 'China' || numericCode === '156',
          supportedCountryNumericCode:
            numericCode && getSupportedCountry(numericCode) ? numericCode : undefined,
          hasCountyChildren: false
        }
      }
    ];
  })
});

export const normalizeChinaProvinceGeoJson = (
  data: RawGlobeFeatureCollection
): GlobeFeatureCollection => ({
  type: 'FeatureCollection',
  features: data.features.flatMap((feature: RawGlobeFeature) => {
    const geometry = normalizePolygonGeometry(feature.geometry);

    if (!geometry) {
      return [];
    }

    const properties = feature.properties ?? {};
    const name = toStringValue(properties.name);
    const adcode = toStringValue(properties.adcode);

    if (!name || !adcode) {
      return [];
    }

    return [
      {
        type: 'Feature',
        geometry,
        properties: {
          dataset: 'china-provinces',
          featureId: `china-province:${adcode}`,
          name,
          label: name,
          level: 'province',
          adcode,
          parentAdcode: getNestedAdcode(properties.parent),
          provinceAdcode: adcode,
          hasCountyChildren: false
        }
      }
    ];
  })
});

export const normalizeChinaCityGeoJson = (
  data: RawGlobeFeatureCollection
): GlobeFeatureCollection => ({
  type: 'FeatureCollection',
  features: data.features.flatMap((feature: RawGlobeFeature) => {
    const geometry = normalizePolygonGeometry(feature.geometry);

    if (!geometry) {
      return [];
    }

    const properties = feature.properties ?? {};
    const name = toStringValue(properties.name);
    const adcode = toStringValue(properties.adcode);
    const level = asLevel(properties.level);

    if (!name || !adcode || !level || level === 'world' || level === 'county') {
      return [];
    }

    const parentAdcode = getNestedAdcode(properties.parent);

    return [
      {
        type: 'Feature',
        geometry,
        properties: {
          dataset: 'china-cities',
          featureId: `china-city:${adcode}`,
          name,
          label: name,
          level,
          adcode,
          parentAdcode,
          provinceAdcode: level === 'province' ? adcode : parentAdcode,
          cityPrefix: adcode.length >= 4 ? adcode.slice(0, 4) : undefined,
          hasCountyChildren: level === 'city' && adcode.endsWith('00') && !adcode.endsWith('0000')
        }
      }
    ];
  })
});

export const normalizeChinaCountyGeoJson = (
  data: RawGlobeFeatureCollection
): GlobeFeatureCollection => ({
  type: 'FeatureCollection',
  features: data.features.flatMap((feature: RawGlobeFeature) => {
    const geometry = normalizePolygonGeometry(feature.geometry);

    if (!geometry) {
      return [];
    }

    const properties = feature.properties ?? {};
    const name = toStringValue(properties.name);
    const gb = toStringValue(properties.gb);

    if (!name || !gb || name === '境界线') {
      return [];
    }

    const adcode = gb.startsWith('156') ? gb.slice(3) : gb;

    if (adcode.length !== 6) {
      return [];
    }

    const provinceAdcode = `${adcode.slice(0, 2)}0000`;
    const cityPrefix = adcode.slice(0, 4);

    return [
      {
        type: 'Feature',
        geometry,
        properties: {
          dataset: 'china-counties',
          featureId: `china-county:${gb}`,
          name,
          label: name,
          level: 'county',
          adcode,
          parentAdcode: `${cityPrefix}00`,
          provinceAdcode,
          cityPrefix,
          hasCountyChildren: false
        }
      }
    ];
  })
});

export const filterCitiesByProvince = (
  data: GlobeFeatureCollection,
  provinceAdcode: string
): GlobeFeatureCollection => {
  if (!provinceAdcode) {
    return EMPTY_GLOBE_FEATURE_COLLECTION;
  }

  return {
    type: 'FeatureCollection',
    features: data.features.filter(
      (feature: GlobeFeature) => feature.properties?.parentAdcode === provinceAdcode
    )
  };
};

export const filterCountiesByParentAdcode = (
  data: GlobeFeatureCollection,
  parentAdcode: string
): GlobeFeatureCollection => {
  const normalizedParentAdcode = toStringValue(parentAdcode);

  if (!normalizedParentAdcode) {
    return EMPTY_GLOBE_FEATURE_COLLECTION;
  }

  if (normalizedParentAdcode.endsWith('0000')) {
    return {
      type: 'FeatureCollection',
      features: data.features.filter(
        (feature: GlobeFeature) => feature.properties?.provinceAdcode === normalizedParentAdcode
      )
    };
  }

  if (!normalizedParentAdcode.endsWith('00')) {
    return EMPTY_GLOBE_FEATURE_COLLECTION;
  }

  const cityPrefix = normalizedParentAdcode.slice(0, 4);

  return {
    type: 'FeatureCollection',
    features: data.features.filter(
      (feature: GlobeFeature) => feature.properties?.cityPrefix === cityPrefix
    )
  };
};

export const isChinaWorldFeature = (feature: GlobeFeature | null | undefined) =>
  feature?.properties?.dataset === 'world' && feature.properties.isChina === true;

export const isSupportedCountryWorldFeature = (
  feature: GlobeFeature | null | undefined
): SupportedCountry | null => {
  if (feature?.properties?.dataset !== 'world') return null;
  const numericCode = feature.properties.numericCode;
  if (!numericCode) return null;
  return getSupportedCountry(numericCode) ?? null;
};

export const getCountyParentAdcode = (feature: GlobeFeature | null | undefined) => {
  if (feature?.properties?.dataset !== 'china-cities') {
    return undefined;
  }

  if (!feature.properties.hasCountyChildren || !feature.properties.adcode) {
    return undefined;
  }

  return feature.properties.adcode;
};

const pushPositions = (value: unknown, positions: Position[]) => {
  if (!Array.isArray(value) || value.length === 0) {
    return;
  }

  if (typeof value[0] === 'number' && typeof value[1] === 'number') {
    positions.push([value[0], value[1]]);
    return;
  }

  for (const nestedValue of value) {
    pushPositions(nestedValue, positions);
  }
};

export const getFeatureBounds = (feature: GlobeFeature | null | undefined) => {
  if (!feature?.geometry) {
    return null;
  }

  const positions: Position[] = [];

  if (feature.geometry.type === 'GeometryCollection') {
    for (const geometry of feature.geometry.geometries) {
      if (geometry.type !== 'GeometryCollection') {
        pushPositions(geometry.coordinates, positions);
      }
    }
  } else {
    pushPositions(feature.geometry.coordinates, positions);
  }

  if (positions.length === 0) {
    return null;
  }

  let minLng = positions[0][0];
  let maxLng = positions[0][0];
  let minLat = positions[0][1];
  let maxLat = positions[0][1];

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
