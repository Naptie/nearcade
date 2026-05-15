import { error, json } from '@sveltejs/kit';
import {
  getAllSupportedDatasets,
  getGlobeGeoJson,
  getSupportedCountryByLevelDataset
} from '$lib/utils/globe/geojson.server';
import { SUPPORTED_COUNTRIES, getSupportedCountryByName } from '$lib/countries';
import mongo from '$lib/db/index.server';
import type { Shop } from '$lib/types';
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
  const idSuffix =
    feature.properties.numericCode && feature.properties.numericCode !== '0'
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

const getCountryPopularityMap = async (): Promise<Map<string, number>> => {
  const db = mongo.db();
  const shopsCollection = db.collection<Shop>('shops');

  const counts = await shopsCollection
    .aggregate<{ _id: string; count: number }>([
      {
        $project: {
          country: {
            $trim: {
              input: {
                $ifNull: [{ $arrayElemAt: ['$address.general', 0] }, '']
              }
            }
          }
        }
      },
      {
        $match: {
          country: { $type: 'string', $ne: '' }
        }
      },
      {
        $group: {
          _id: '$country',
          count: { $sum: 1 }
        }
      }
    ])
    .toArray();

  return new Map(counts.map(({ _id, count }) => [_id, count]));
};

const getCountryOptions = async (): Promise<AddressOption[]> => {
  const worldFeatures = getGlobeGeoJson('world').features;
  const supportedNames = new Set(SUPPORTED_COUNTRIES.map((country) => country.name));
  const popularityMap = await getCountryPopularityMap();

  const compareByPopularity = (
    left: AddressOption,
    right: AddressOption,
    getKey: (option: AddressOption) => string
  ) => {
    const leftCount = popularityMap.get(getKey(left)) || 0;
    const rightCount = popularityMap.get(getKey(right)) || 0;
    if (leftCount !== rightCount) return rightCount - leftCount;
    return left.label.localeCompare(right.label, 'en');
  };

  const supportedOptions = SUPPORTED_COUNTRIES.flatMap((country) => {
    const index = worldFeatures.findIndex((f) => f.properties.name === country.name);
    return index >= 0 ? [toCountryOption(worldFeatures[index], index)] : [];
  }).sort((left, right) =>
    compareByPopularity(
      left,
      right,
      (option) => getSupportedCountryByName(option.value)?.addressName || ''
    )
  );

  const unsupportedOptions = worldFeatures
    .map((feature, index) => ({ feature, index }))
    .filter(({ feature }) => !supportedNames.has(feature.properties.name))
    .map(({ feature, index }) => toCountryOption(feature, index))
    .sort((left, right) => compareByPopularity(left, right, (option) => option.value));

  return [...supportedOptions, ...unsupportedOptions];
};

export const GET: RequestHandler = async ({ url }) => {
  const dataset = url.searchParams.get('dataset')?.trim() || 'countries';
  const parentAdcode = url.searchParams.get('parentAdcode')?.trim() || undefined;

  if (dataset === 'countries') {
    return json(await getCountryOptions(), {
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

  const options = getGlobeGeoJson(dataset as GlobeDataset, parentAdcode).features.map(
    toRegionOption
  );

  return json(options, {
    headers: {
      'Cache-Control': levelConfig?.level.requiresParentAdcode
        ? 'public, max-age=3600, stale-while-revalidate=86400'
        : 'public, max-age=86400, stale-while-revalidate=604800'
    }
  });
};
