/**
 * The organization search behind the admin membership pickers.
 *
 * Universities and clubs live in two separate collections, so the procedure
 * picks the collection from the requested type and searches both the id, the
 * slug and the name.
 */

import { implement } from '@orpc/server';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { toPlainArray } from '$lib/utils';
import { buildSearchPattern } from '$lib/utils/search';
import { adminContract } from '../../contracts/admin';
import type { ApiContext } from '../../context';
import { apiError, rethrowApiError } from '../../errors';
import { siteAdmin } from './shared.server';

const impl = implement(adminContract).$context<ApiContext>();

export const adminOrganizationsImplementation = {
  /** `GET /api/admin/organizations/search` */
  searchOrganizations: impl.searchOrganizations.use(siteAdmin).handler(async ({ input }) => {
    const type = input.type;
    const q = input.q;

    if (!['university', 'club'].includes(type)) {
      apiError('BAD_REQUEST', m.invalid_organization_type());
    }

    if (!q) {
      return { organizations: [] };
    }

    try {
      const db = mongo.db();
      const collectionName = type === 'university' ? 'universities' : 'clubs';

      // `buildSearchPattern` escapes the query, so a search term containing
      // regex metacharacters is matched literally instead of being able to
      // rewrite the query's shape (or stall it).
      const orgPattern = buildSearchPattern(q);

      const organizations = (await db
        .collection(collectionName)
        .find({
          $or: [
            { id: q },
            { slug: q },
            { id: { $regex: orgPattern, $options: 'i' } },
            { slug: { $regex: orgPattern, $options: 'i' } },
            { name: { $regex: orgPattern, $options: 'i' } }
          ]
        })
        .limit(20)
        .project({ _id: 0, id: 1, name: 1, slug: 1 })
        .toArray()) as Array<{ id: string; name: string; slug?: string }>;

      return { organizations: toPlainArray(organizations) };
    } catch (err) {
      rethrowApiError(err, m.failed_to_search_organizations());
    }
  })
};
