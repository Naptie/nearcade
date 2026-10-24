/**
 * The members of a university.
 *
 * A member whose profile is not public to the university is only listed for
 * the readers who belong to that university — everybody else would learn
 * more about the member than the member allows.
 */
import { implement } from '@orpc/server';
import { universitiesContract } from '../../contracts/universities';
import type { ApiContext } from '../../context';
import { apiError, rethrowApiError } from '../../errors';
import { toPlainWire } from '../../wire.server';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';

import { universityMembersResponseSchema } from '$lib/schemas/organizations';
import { PAGINATION } from '$lib/constants';
import { type UniversityMember } from '$lib/types';
import { findUniversityByRouteId } from './shared.server';

const impl = implement(universitiesContract).$context<ApiContext>();

export const universitiesMembersImplementation = {
  members: impl.members.handler(async ({ input, context }) => {
    try {
      const { id: universityId, page } = input;
      const skip = (page - 1) * PAGINATION.PAGE_SIZE;

      const db = mongo.db();
      const membersCollection = db.collection<UniversityMember>('university_members');

      // Check if university exists
      const university = await findUniversityByRouteId(universityId);
      if (!university) {
        apiError('NOT_FOUND', m.university_not_found());
      }

      const session = context.session;
      let isUniversityMember = false;
      if (session?.user) {
        const userMembership = await membersCollection.findOne({
          userId: session.user.id,
          universityId: university.id
        });
        isUniversityMember = !!userMembership?.memberType;
      }

      // Get members with pagination
      const members = await membersCollection
        .aggregate([
          { $match: { universityId: university.id } },
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
              verifiedAt: 1,
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
        .toArray();

      // Check if there are more members
      const totalMembers = await membersCollection.countDocuments({
        universityId: university.id
      });
      const hasMore = page * PAGINATION.PAGE_SIZE < totalMembers;

      return toPlainWire(universityMembersResponseSchema, {
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
