import { json, error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getShopChangelogEntries } from '$lib/utils/shops/changelog.server';
import mongo from '$lib/db/index.server';
import { PAGINATION } from '$lib/constants';
import { m } from '$lib/paraglide/messages';

export const GET: RequestHandler = async ({ params, url, locals }) => {
  const { id } = params;
  const shopId = parseInt(id);
  if (isNaN(shopId)) {
    error(400, m.invalid_shop_id());
  }

  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const limit = parseInt(url.searchParams.get('limit') || '0') || PAGINATION.PAGE_SIZE;

  if (page < 1 || limit < 1 || limit > 100) {
    error(400, m.invalid_pagination_parameters());
  }

  try {
    const { entries, total } = await getShopChangelogEntries(mongo, shopId, {
      limit,
      offset: (page - 1) * limit,
      viewer: locals.session?.user ?? null
    });

    return json({
      entries,
      total,
      page,
      limit,
      hasMore: page * limit < total,
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error fetching shop changelog:', err);
    error(500, m.failed_to_fetch_changelog_entries());
  }
};
