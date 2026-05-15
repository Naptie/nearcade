import { isHttpError, isRedirect, json } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getChangelogEntries } from '$lib/utils/universities-clubs/changelog.server';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { toPlainObject } from '$lib/utils';
import {
  universityChangelogQuerySchema,
  universityChangelogResponseSchema,
  universityIdParamSchema
} from '$lib/schemas/organizations';
import { parseParamsOrError, parseQueryOrError } from '$lib/utils/validation.server';

export const GET: RequestHandler = async ({ params, url }) => {
  const { id } = parseParamsOrError(universityIdParamSchema, params);
  const { page, limit } = parseQueryOrError(universityChangelogQuerySchema, url);

  try {
    const { entries, total } = await getChangelogEntries(mongo, id, {
      limit,
      offset: (page - 1) * limit
    });

    return json(
      universityChangelogResponseSchema.parse(
        toPlainObject({
          entries,
          total,
          page,
          limit,
          hasMore: page * limit < total,
          totalPages: Math.ceil(total / limit)
        })
      )
    );
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error fetching changelog entries:', err);
    error(500, m.failed_to_fetch_changelog_entries());
  }
};
