import worldGeoJson from '$lib/assets/globe/world.geo.json';
import chinaProvincesGeoJson from '$lib/assets/globe/china_provinces.geo.json';
import chinaCitiesGeoJson from '$lib/assets/globe/china_cities.geo.json';
import chinaCountiesGeoJson from '$lib/assets/globe/china_counties.geo.json';
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

const getGeoJsonCache = (): GlobeGeoJsonCache => {
  if (geoJsonCache) {
    return geoJsonCache;
  }

  geoJsonCache = {
    world: normalizeWorldGeoJson(worldGeoJson as RawGlobeFeatureCollection),
    'china-provinces': normalizeChinaProvinceGeoJson(
      chinaProvincesGeoJson as RawGlobeFeatureCollection
    ),
    'china-cities': normalizeChinaCityGeoJson(chinaCitiesGeoJson as RawGlobeFeatureCollection),
    'china-counties': normalizeChinaCountyGeoJson(chinaCountiesGeoJson as RawGlobeFeatureCollection)
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
