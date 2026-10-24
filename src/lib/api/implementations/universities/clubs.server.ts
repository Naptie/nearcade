/**
 * The clubs of a university, paginated.
 *
 * The member count of a club is counted from the membership collection, so
 * it never disagrees with the member list the club itself serves.
 */
import { implement } from '@orpc/server';
import { universitiesContract } from '../../contracts/universities';
import type { ApiContext } from '../../context';
import { apiError, rethrowApiError } from '../../errors';
import { toPlainWire } from '../../wire.server';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';

import { normalizeClubDocument } from '$lib/utils/organizations.server';
import { universityClubListResponseSchema } from '$lib/schemas/organizations';
import { PAGINATION } from '$lib/constants';
import { findUniversityByRouteId } from './shared.server';

const impl = implement(universitiesContract).$context<ApiContext>();

export const universitiesClubsImplementation = {
  clubs: impl.clubs.handler(async ({ input }) => {
    try {
      const { id: universityId, page } = input;
      const skip = (page - 1) * PAGINATION.PAGE_SIZE;

      const db = mongo.db();
      const clubsCollection = db.collection('clubs');

      // Check if university exists
      const university = await findUniversityByRouteId(universityId);
      if (!university) {
        apiError('NOT_FOUND', m.university_not_found());
      }

      // Get clubs with pagination
      const clubsAggregation = await clubsCollection
        .aggregate([
          { $match: { universityId: university.id } },
          { $skip: skip },
          { $limit: PAGINATION.PAGE_SIZE },
          {
            $lookup: {
              from: 'club_members',
              localField: 'id',
              foreignField: 'clubId',
              as: 'members'
            }
          },
          {
            $project: {
              _id: 1,
              id: 1,
              name: 1,
              description: 1,
              slug: 1,
              avatarUrl: 1,
              membersCount: { $size: '$members' },
              createdAt: 1
            }
          },
          { $sort: { createdAt: -1 } }
        ])
        .toArray();

      // Check if there are more clubs
      const totalClubs = await clubsCollection.countDocuments({
        universityId: university.id
      });
      const hasMore = page * PAGINATION.PAGE_SIZE < totalClubs;

      const normalizedClubs = clubsAggregation.map((club) => normalizeClubDocument(club));

      return toPlainWire(universityClubListResponseSchema, {
        clubs: normalizedClubs,
        hasMore,
        page,
        totalClubs
      });
    } catch (err) {
      rethrowApiError(err, m.internal_server_error());
    }
  })
};
