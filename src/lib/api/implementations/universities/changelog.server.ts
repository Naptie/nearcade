/**
 * The university changelog: the paginated record of what changed.
 */
import { implement } from '@orpc/server';
import { universitiesContract } from '../../contracts/universities';
import type { ApiContext } from '../../context';
import { rethrowApiError } from '../../errors';
import { toPlainWire } from '../../wire.server';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';

import { getChangelogEntries } from '$lib/utils/universities-clubs/changelog.server';
import { universityChangelogResponseSchema } from '$lib/schemas/organizations';

const impl = implement(universitiesContract).$context<ApiContext>();

export const universitiesChangelogImplementation = {
  changelog: impl.changelog.handler(async ({ input }) => {
    const { id, page, limit } = input;

    try {
      const { entries, total } = await getChangelogEntries(mongo, id, {
        limit,
        offset: (page - 1) * limit
      });

      return toPlainWire(universityChangelogResponseSchema, {
        entries,
        total,
        page,
        limit,
        hasMore: page * limit < total,
        totalPages: Math.ceil(total / limit)
      });
    } catch (err) {
      rethrowApiError(err, m.failed_to_fetch_changelog_entries());
    }
  })
};
