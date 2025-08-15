import { json } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getChangelogEntries } from '$lib/utils/changelog.server';
import client from '$lib/db/index.server';

export const GET: RequestHandler = async ({ params, url }) => {
  const { id } = params;
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const limit = parseInt(url.searchParams.get('limit') || '20', 10);

  if (page < 1 || limit < 1 || limit > 100) {
    error(400, 'Invalid pagination parameters');
  }

  try {
    const { entries, total } = await getChangelogEntries(client, id, {
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
    console.error('Error fetching changelog entries:', err);
    error(500, 'Failed to fetch changelog entries');
  }
};
