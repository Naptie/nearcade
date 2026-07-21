import { json, error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRecentShopChangelogEntries } from '$lib/utils/shops/changelog.server';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { shopChangelogListResponseSchema, shopChangelogQuerySchema } from '$lib/schemas/shops';
import { parseQueryOrError } from '$lib/utils/validation.server';
import { toPlainObject } from '$lib/utils';

export const GET: RequestHandler = async ({ url, locals }) => {
  const { page, limit } = parseQueryOrError(shopChangelogQuerySchema, url);

  try {
    const { entries, total } = await getRecentShopChangelogEntries(mongo, {
      limit,
      offset: (page - 1) * limit,
      viewer: locals.session?.user ?? null
    });

    const response = shopChangelogListResponseSchema.parse(
      toPlainObject({
        entries,
        total,
        page,
        limit,
        hasMore: page * limit < total,
        totalPages: Math.ceil(total / limit)
      })
    );

    return json(response, {
      headers: { 'Cache-Control': 'public, max-age=30' }
    });
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error fetching recent shop changelog:', err);
    error(500, m.failed_to_fetch_changelog_entries());
  }
};
