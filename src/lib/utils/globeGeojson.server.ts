import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  filterCitiesByProvince,
  filterCountiesByParentAdcode,
  normalizeChinaCityGeoJson,
  normalizeChinaCountyGeoJson,
  normalizeChinaProvinceGeoJson,
  normalizeWorldGeoJson,
  type GlobeDataset,
  type GlobeFeatureCollection,
  type RawGlobeFeatureCollection
} from '$lib/utils/globeGeojson';

type GlobeGeoJsonCache = {
  world: GlobeFeatureCollection;
  'china-provinces': GlobeFeatureCollection;
  'china-cities': GlobeFeatureCollection;
  'china-counties': GlobeFeatureCollection;
};

let geoJsonCache: GlobeGeoJsonCache | undefined;

const readAssetGeoJson = (fileName: string) => {
  const filePath = join(process.cwd(), 'src', 'lib', 'assets', fileName);

  return JSON.parse(readFileSync(filePath, 'utf8')) as RawGlobeFeatureCollection;
};

const getGeoJsonCache = (): GlobeGeoJsonCache => {
  if (geoJsonCache) {
    return geoJsonCache;
  }

  geoJsonCache = {
    world: normalizeWorldGeoJson(readAssetGeoJson('world.geojson')),
    'china-provinces': normalizeChinaProvinceGeoJson(readAssetGeoJson('china_provinces.geojson')),
    'china-cities': normalizeChinaCityGeoJson(readAssetGeoJson('china_cities.geojson')),
    'china-counties': normalizeChinaCountyGeoJson(readAssetGeoJson('china_counties.geojson'))
  };

  return geoJsonCache;
};

export const getGlobeGeoJson = (
  dataset: GlobeDataset,
  parentAdcode?: string
): GlobeFeatureCollection => {
  const cache = getGeoJsonCache();

  switch (dataset) {
    case 'world':
      return cache.world;
    case 'china-provinces':
      return cache['china-provinces'];
    case 'china-cities':
      return parentAdcode
        ? filterCitiesByProvince(cache['china-cities'], parentAdcode)
        : cache['china-cities'];
    case 'china-counties':
      return parentAdcode
        ? filterCountiesByParentAdcode(cache['china-counties'], parentAdcode)
        : cache['china-counties'];
  }
};
