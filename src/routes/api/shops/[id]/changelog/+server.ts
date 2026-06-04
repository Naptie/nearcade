import { json, error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getShopChangelogEntries } from '$lib/utils/shops/changelog.server';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import {
  shopChangelogListResponseSchema,
  shopChangelogQuerySchema,
  shopIdParamSchema
} from '$lib/schemas/shops';
import { parseParamsOrError, parseQueryOrError } from '$lib/utils/validation.server';
import { toPlainObject } from '$lib/utils';

export const GET: RequestHandler = async ({ params, url, locals }) => {
  const { id: shopId } = parseParamsOrError(shopIdParamSchema, params);
  const { page, limit } = parseQueryOrError(shopChangelogQuerySchema, url);

  try {
    const { entries, total } = await getShopChangelogEntries(mongo, shopId, {
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

    return json(response);
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error fetching shop changelog:', err);
    error(500, m.failed_to_fetch_changelog_entries());
  }
};
