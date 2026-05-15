import { getSupportedCountry, type SupportedCountry } from '$lib/countries';
import {
  emptyGlobeFeatureCollection,
  normalizePolygonGeometry,
  toStringValue,
  type GlobeFeature,
  type GlobeFeatureCollection,
  type RawGlobeFeatureCollection
} from './geojson-helpers';

// Re-export everything consumers need from here so existing imports don't break.
export {
  emptyGlobeFeatureCollection,
  getFeatureBounds,
  type GlobeFeature,
  type GlobeFeatureCollection,
  type GlobeFeatureLevel,
  type GlobeFeatureProperties,
  type RawGlobeFeatureCollection
} from './geojson-helpers';

// ---------------------------------------------------------------------------
// GlobeDataset type
// 'world' plus any dataset key declared in SUPPORTED_COUNTRIES.
// ---------------------------------------------------------------------------

export type GlobeDataset = 'world' | (string & Record<never, never>);

// ---------------------------------------------------------------------------
// World GeoJSON normalizer
// ---------------------------------------------------------------------------

export const normalizeWorldGeoJson = (data: RawGlobeFeatureCollection): GlobeFeatureCollection => ({
  type: 'FeatureCollection',
  features: data.features.flatMap((feature, index) => {
    const geometry = normalizePolygonGeometry(feature.geometry);
    if (!geometry) return [];

    const properties = feature.properties ?? {};
    const name = toStringValue(properties.name);
    if (!name) return [];

    const numericCode = toStringValue(properties.numericCode);

    return [
      {
        type: 'Feature',
        geometry,
        properties: {
          dataset: 'world' as const,
          featureId: `world:${numericCode ?? name}:${index}`,
          name,
          label: name,
          level: 'world' as const,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  if (feature?.properties?.dataset !== 'china-cities') return undefined;
  if (!feature.properties.hasCountyChildren || !feature.properties.adcode) return undefined;
  return feature.properties.adcode;
};

// Keep filterCitiesByProvince / filterCountiesByParentAdcode as named exports for
// any code that still imports them directly from geojson.ts.
export const filterCitiesByProvince = (
  data: GlobeFeatureCollection,
  provinceAdcode: string
): GlobeFeatureCollection => {
  if (!provinceAdcode) return emptyGlobeFeatureCollection();
  return {
    type: 'FeatureCollection',
    features: data.features.filter(
      (f: GlobeFeature) => f.properties?.parentAdcode === provinceAdcode
    )
  };
};

export const filterCountiesByParentAdcode = (
  data: GlobeFeatureCollection,
  parentAdcode: string
): GlobeFeatureCollection => {
  const normalized = toStringValue(parentAdcode);
  if (!normalized) return emptyGlobeFeatureCollection();

  if (normalized.endsWith('0000')) {
    return {
      type: 'FeatureCollection',
      features: data.features.filter(
        (f: GlobeFeature) => f.properties?.provinceAdcode === normalized
      )
    };
  }

  if (!normalized.endsWith('00')) return emptyGlobeFeatureCollection();

  const cityPrefix = normalized.slice(0, 4);
  return {
    type: 'FeatureCollection',
    features: data.features.filter((f: GlobeFeature) => f.properties?.cityPrefix === cityPrefix)
  };
};
