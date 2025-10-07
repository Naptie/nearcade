import { isHttpError, isRedirect, json } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getChangelogEntries } from '$lib/utils/changelog.server';
import mongo from '$lib/db/index.server';
import { PAGINATION } from '$lib/constants';
import { m } from '$lib/paraglide/messages';

export const GET: RequestHandler = async ({ params, url }) => {
  const { id } = params;
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const limit = parseInt(url.searchParams.get('limit') || '0') || PAGINATION.PAGE_SIZE;

  if (page < 1 || limit < 1 || limit > 100) {
    error(400, m.error_invalid_pagination_parameters());
  }

  try {
    const { entries, total } = await getChangelogEntries(mongo, id, {
      limit,
      offset: (page - 1) * limit
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
    console.error('Error fetching changelog entries:', err);
    error(500, m.error_failed_to_fetch_changelog_entries());
  }
};
