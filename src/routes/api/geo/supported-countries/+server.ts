import { json } from '@sveltejs/kit';
import { SUPPORTED_COUNTRIES } from '$lib/countries';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  return json(
    {
      supportedCountries: SUPPORTED_COUNTRIES.map((country) => ({
        numericCode: country.numericCode,
        name: country.name,
        addressName: country.addressName,
        levels: country.levels.map((level) => ({
          dataset: level.dataset,
          levelName: level.levelName,
          hasChildren: level.hasChildren,
          requiresParentAdcode: level.requiresParentAdcode ?? false
        }))
      }))
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800'
      }
    }
  );
};