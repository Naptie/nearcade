// Static imports of raw GeoJSON assets – these are the ONLY place where
// country-specific file paths live.  Adding a new supported country means
// adding its raw import here and an entry in RAW_DATA_MAP below.
import worldGeoJson from '$lib/assets/globe/world.geo.json';
import chinaProvincesGeoJson from '$lib/assets/globe/china_provinces.geo.json';
import chinaCitiesGeoJson from '$lib/assets/globe/china_cities.geo.json';
import chinaCountiesGeoJson from '$lib/assets/globe/china_counties.geo.json';

import { SUPPORTED_COUNTRIES, type SupportedCountryLevel } from '$lib/countries';
import {
  normalizeWorldGeoJson,
  type GlobeDataset,
  type GlobeFeatureCollection,
  type RawGlobeFeatureCollection
} from '$lib/utils/globe/geojson';

// ---------------------------------------------------------------------------
// Mapping: dataset key → raw imported JSON
// When you add a new SupportedCountry with new datasets, add entries here.
// ---------------------------------------------------------------------------

const RAW_DATA_MAP: Record<string, RawGlobeFeatureCollection> = {
  'china-provinces': chinaProvincesGeoJson as RawGlobeFeatureCollection,
  'china-cities': chinaCitiesGeoJson as RawGlobeFeatureCollection,
  'china-counties': chinaCountiesGeoJson as RawGlobeFeatureCollection
};

// ---------------------------------------------------------------------------
// Cache – built once from SUPPORTED_COUNTRIES
// ---------------------------------------------------------------------------

type GeoJsonCache = Record<string, GlobeFeatureCollection>;

let geoJsonCache: GeoJsonCache | undefined;

const buildCache = (): GeoJsonCache => {
  const cache: GeoJsonCache = {
    world: normalizeWorldGeoJson(worldGeoJson as RawGlobeFeatureCollection)
  };

  for (const country of SUPPORTED_COUNTRIES) {
    for (const level of country.levels) {
      const raw = RAW_DATA_MAP[level.dataset];
      if (!raw) {
        console.error(
          `[geojson.server] No raw data found for dataset "${level.dataset}" ` +
            `(country ${country.name}). Add an entry to RAW_DATA_MAP.`
        );
        continue;
      }
      cache[level.dataset] = level.normalizeGeoJson(raw);
    }
  }

  return cache;
};

const getGeoJsonCache = (): GeoJsonCache => {
  if (!geoJsonCache) geoJsonCache = buildCache();
  return geoJsonCache;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findLevelConfig(dataset: string): SupportedCountryLevel | undefined {
  for (const country of SUPPORTED_COUNTRIES) {
    const level = country.levels.find((l) => l.dataset === dataset);
    if (level) return level;
  }
  return undefined;
}

/** All non-world dataset keys declared by SUPPORTED_COUNTRIES. */
export const getAllSupportedDatasets = (): string[] =>
  SUPPORTED_COUNTRIES.flatMap((c) => c.levels.map((l) => l.dataset));

/** True when the given dataset requires a parentAdcode query param. */
export const datasetRequiresParentAdcode = (dataset: string): boolean =>
  findLevelConfig(dataset)?.requiresParentAdcode ?? false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Retrieve a normalised GeoJSON dataset, with optional parentAdcode filter. */
export const getGlobeGeoJson = (
  dataset: GlobeDataset,
  parentAdcode?: string
): GlobeFeatureCollection => {
  const cache = getGeoJsonCache();

  if (dataset === 'world') return cache.world;

  const levelData = cache[dataset];
  if (!levelData) return { type: 'FeatureCollection', features: [] };

  if (!parentAdcode) return levelData;

  const levelConfig = findLevelConfig(dataset);
  if (levelConfig?.filterGeoJson) {
    return levelConfig.filterGeoJson(levelData, parentAdcode);
  }

  return levelData;
};
