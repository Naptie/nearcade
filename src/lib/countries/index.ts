import {
  asLevel,
  emptyGlobeFeatureCollection,
  getNestedAdcode,
  normalizePolygonGeometry,
  toStringValue,
  type GlobeFeature,
  type GlobeFeatureCollection,
  type RawGlobeFeatureCollection
} from '$lib/utils/globe/geojson-helpers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A filter function applied server-side when a parentAdcode is given. */
export type LevelFilterFn = (
  data: GlobeFeatureCollection,
  parentAdcode: string
) => GlobeFeatureCollection;

export interface SupportedCountryLevel {
  /** Key used in API calls, e.g. 'china-provinces'. */
  dataset: string;
  /** Human-readable level name (province | city | county …). */
  levelName: string;
  /** Whether cities/counties of this level have county-level children. */
  hasChildren: boolean;
  /** Whether the API must receive a parentAdcode to return useful data. */
  requiresParentAdcode?: boolean;
  /** Transform raw GeoJSON into normalised GlobeFeatureCollection. */
  normalizeGeoJson: (data: RawGlobeFeatureCollection) => GlobeFeatureCollection;
  /** Optional server-side filter by parentAdcode. */
  filterGeoJson?: LevelFilterFn;
}

export interface SupportedCountry {
  /** ISO 3166-1 numeric code. */
  numericCode: string;
  /** Name as it appears in world.geo.json. */
  name: string;
  /** Native address name used in shop address arrays. */
  addressName: string;
  /** Ordered from coarsest (e.g. province) to finest (e.g. county). */
  levels: SupportedCountryLevel[];
}

// ---------------------------------------------------------------------------
// China normalizers
// ---------------------------------------------------------------------------

const normalizeChinaProvinceGeoJson = (
  data: RawGlobeFeatureCollection
): GlobeFeatureCollection => ({
  type: 'FeatureCollection',
  features: data.features.flatMap((feature) => {
    const geometry = normalizePolygonGeometry(feature.geometry);
    if (!geometry) return [];

    const props = feature.properties ?? {};
    const name = toStringValue(props.name);
    const adcode = toStringValue(props.adcode);
    if (!name || !adcode) return [];

    return [
      {
        type: 'Feature',
        geometry,
        properties: {
          dataset: 'china-provinces',
          featureId: `china-province:${adcode}`,
          name,
          label: name,
          level: 'province' as const,
          adcode,
          parentAdcode: getNestedAdcode(props.parent),
          provinceAdcode: adcode,
          hasCountyChildren: false
        }
      }
    ];
  })
});

const normalizeChinaCityGeoJson = (data: RawGlobeFeatureCollection): GlobeFeatureCollection => ({
  type: 'FeatureCollection',
  features: data.features.flatMap((feature) => {
    const geometry = normalizePolygonGeometry(feature.geometry);
    if (!geometry) return [];

    const props = feature.properties ?? {};
    const name = toStringValue(props.name);
    const adcode = toStringValue(props.adcode);
    const level = asLevel(props.level);

    if (!name || !adcode || !level || level === 'world' || level === 'county') return [];

    const parentAdcode = getNestedAdcode(props.parent);

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

const normalizeChinaCountyGeoJson = (data: RawGlobeFeatureCollection): GlobeFeatureCollection => ({
  type: 'FeatureCollection',
  features: data.features.flatMap((feature) => {
    const geometry = normalizePolygonGeometry(feature.geometry);
    if (!geometry) return [];

    const props = feature.properties ?? {};
    const name = toStringValue(props.name);
    const gb = toStringValue(props.gb);

    if (!name || !gb || name === '境界线') return [];

    const adcode = gb.startsWith('156') ? gb.slice(3) : gb;
    if (adcode.length !== 6) return [];

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
          level: 'county' as const,
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

const filterChinaCitiesByProvince = (
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

const filterChinaCountiesByParentAdcode = (
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

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const SUPPORTED_COUNTRIES: SupportedCountry[] = [
  {
    numericCode: '156',
    name: 'China',
    addressName: '中国',
    levels: [
      {
        dataset: 'china-provinces',
        levelName: 'province',
        hasChildren: true,
        normalizeGeoJson: normalizeChinaProvinceGeoJson
      },
      {
        dataset: 'china-cities',
        levelName: 'city',
        hasChildren: true,
        normalizeGeoJson: normalizeChinaCityGeoJson,
        filterGeoJson: filterChinaCitiesByProvince
      },
      {
        dataset: 'china-counties',
        levelName: 'county',
        hasChildren: false,
        requiresParentAdcode: true,
        normalizeGeoJson: normalizeChinaCountyGeoJson,
        filterGeoJson: filterChinaCountiesByParentAdcode
      }
    ]
  }
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export const getSupportedCountry = (numericCode: string): SupportedCountry | undefined =>
  SUPPORTED_COUNTRIES.find((c) => c.numericCode === numericCode);

export const getSupportedCountryByName = (name: string): SupportedCountry | undefined =>
  SUPPORTED_COUNTRIES.find((c) => c.name === name);

export const getSupportedCountryByDataset = (dataset: string): SupportedCountry | undefined =>
  SUPPORTED_COUNTRIES.find((c) => c.levels.some((l) => l.dataset === dataset));

export const getSupportedCountryLevelByDataset = (
  dataset: string
): { country: SupportedCountry; level: SupportedCountryLevel; index: number } | undefined => {
  for (const country of SUPPORTED_COUNTRIES) {
    const index = country.levels.findIndex((l) => l.dataset === dataset);
    if (index >= 0) return { country, level: country.levels[index], index };
  }
  return undefined;
};
