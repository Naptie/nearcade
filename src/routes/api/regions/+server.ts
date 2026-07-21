import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSelectorOptions } from '$lib/regions/utils.server';

/**
 * GET /api/regions?parentId=<id>&locale=<locale>
 *
 * Returns child regions for the hierarchical address dropdown.
 * When `parentId` is omitted or null, returns top-level countries.
 */
export const GET: RequestHandler = async ({ url }) => {
  const parentId = url.searchParams.get('parentId') || null;
  const locale = url.searchParams.get('locale') || 'en';

  try {
    const options = await getSelectorOptions(parentId, locale);

    return json(options, {
      headers: {
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400'
      }
    });
  } catch (err) {
    console.error('Error loading region options:', err);
    return json({ error: 'Failed to load region options' }, { status: 500 });
  }
};
