/**
 * The members of a club.
 *
 * A member whose profile is not public to the university is only listed for
 * the readers who belong to that university — everybody else would learn
 * more about the member than the member allows.
 */
import { implement } from '@orpc/server';
import { clubsContract } from '../../contracts/clubs';
import type { ApiContext } from '../../context';
import { apiError, rethrowApiError } from '../../errors';
import { toPlainWire } from '../../wire.server';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { protect } from '$lib/utils';
import { clubMembersResponseSchema } from '$lib/schemas/organizations';
import { PAGINATION } from '$lib/constants';
import { type ClubMember, type UniversityMember } from '$lib/types';
import { findClubByRouteId } from './shared';

const impl = implement(clubsContract).$context<ApiContext>();

export const clubsMembersImplementation = {
  members: impl.members.handler(async ({ input, context }) => {
    try {
      const { id: clubId, page } = input;
      const skip = (page - 1) * PAGINATION.PAGE_SIZE;

      const db = mongo.db();
      const membersCollection = db.collection<ClubMember>('club_members');

      // Check if club exists
      const club = await findClubByRouteId(clubId);
      if (!club) {
        apiError('NOT_FOUND', m.club_not_found());
      }

      const session = context.session;
      let isUniversityMember = false;
      if (session?.user) {
        const userMembership = await db.collection<UniversityMember>('university_members').findOne({
          userId: session.user.id,
          universityId: club.universityId
        });
        isUniversityMember = !!userMembership?.memberType;
      }

      // Get members with pagination
      const members = await membersCollection
        .aggregate([
          { $match: { clubId: club.id } },
          { $skip: skip },
          { $limit: PAGINATION.PAGE_SIZE },
          {
            $lookup: {
              from: 'users',
              localField: 'userId',
              foreignField: 'id',
              as: 'user'
            }
          },
          { $unwind: '$user' },
          ...(isUniversityMember
            ? []
            : [
                {
                  $match: {
                    'user.isUniversityPublic': true
                  }
                }
              ]),
          {
            $project: {
              _id: 1,
              userId: 1,
              memberType: 1,
              joinedAt: 1,
              user: {
                id: '$user.id',
                name: '$user.name',
                displayName: '$user.displayName',
                image: '$user.image'
              }
            }
          },
          { $sort: { joinedAt: -1 } }
        ])
        .toArray()
        .then((results) => results.map((r) => ({ ...r, user: protect(r.user) })));

      // Check if there are more members
      const totalMembers = await membersCollection.countDocuments({
        clubId: club.id
      });
      const hasMore = page * PAGINATION.PAGE_SIZE < totalMembers;

      return toPlainWire(clubMembersResponseSchema, {
        members,
        hasMore,
        page,
        totalMembers
      });
    } catch (err) {
      rethrowApiError(err, m.internal_server_error());
    }
  })
};
