import { error, json } from '@sveltejs/kit';
import {
  getAllSupportedDatasets,
  getGlobeGeoJson,
  getSupportedCountryByLevelDataset
} from '$lib/utils/globe/geojson.server';
import { SUPPORTED_COUNTRIES, getSupportedCountryByName } from '$lib/countries';
import type { GlobeDataset, GlobeFeature } from '$lib/utils/globe/geojson';
import type { RequestHandler } from './$types';

type AddressOption = {
  id: string;
  value: string;
  label: string;
  adcode?: string;
  supported?: boolean;
};

const SUPPORTED_DATASETS = new Set(getAllSupportedDatasets());

const toCountryOption = (feature: GlobeFeature, index: number): AddressOption => {
  const name = feature.properties.name;
  const supportedCountry = getSupportedCountryByName(name);
  const idSuffix = feature.properties.numericCode && feature.properties.numericCode !== '0'
    ? feature.properties.numericCode
    : `${name}:${index}`;

  if (supportedCountry) {
    return {
      id: `country:${idSuffix}`,
      value: name,
      label: `${supportedCountry.addressName} (${supportedCountry.name})`,
      supported: true
    };
  }

  return {
    id: `country:${idSuffix}`,
    value: name,
    label: name
  };
};

const toRegionOption = (feature: GlobeFeature): AddressOption => ({
  id: feature.properties.featureId,
  value: feature.properties.name,
  label: feature.properties.label || feature.properties.name,
  adcode: feature.properties.adcode
});

const getCountryOptions = (): AddressOption[] => {
  const worldFeatures = getGlobeGeoJson('world').features;
  const supportedNames = new Set(SUPPORTED_COUNTRIES.map((country) => country.name));

  const supportedOptions = SUPPORTED_COUNTRIES.flatMap((country) => {
    const index = worldFeatures.findIndex((f) => f.properties.name === country.name);
    return index >= 0 ? [toCountryOption(worldFeatures[index], index)] : [];
  });

  const unsupportedOptions = worldFeatures
    .map((feature, index) => ({ feature, index }))
    .filter(({ feature }) => !supportedNames.has(feature.properties.name))
    .map(({ feature, index }) => toCountryOption(feature, index));

  return [...supportedOptions, ...unsupportedOptions];
};

export const GET: RequestHandler = ({ url }) => {
  const dataset = url.searchParams.get('dataset')?.trim() || 'countries';
  const parentAdcode = url.searchParams.get('parentAdcode')?.trim() || undefined;

  if (dataset === 'countries') {
    return json(getCountryOptions(), {
      headers: {
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800'
      }
    });
  }

  if (!SUPPORTED_DATASETS.has(dataset)) {
    error(400, 'Invalid address option dataset');
  }

  const levelConfig = getSupportedCountryByLevelDataset(dataset);
  if (levelConfig?.level.requiresParentAdcode && !parentAdcode) {
    error(400, 'A parentAdcode is required for this dataset');
  }

  const options = getGlobeGeoJson(dataset as GlobeDataset, parentAdcode).features.map(toRegionOption);

  return json(options, {
    headers: {
      'Cache-Control': levelConfig?.level.requiresParentAdcode
        ? 'public, max-age=3600, stale-while-revalidate=86400'
        : 'public, max-age=86400, stale-while-revalidate=604800'
    }
  });
};
