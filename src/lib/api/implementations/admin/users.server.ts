/**
 * The admin user tools: one user with its memberships, and the user list.
 *
 * The list has two modes — a plain projection for the machine creation modal
 * and the detailed, paginated one for the admin user management page.
 */

import { implement } from '@orpc/server';
import type { User } from '$lib/auth/types';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import type { Club, ClubMember, University, UniversityMember } from '$lib/types';
import { buildSearchPattern } from '$lib/utils/search';
import {
  adminContract,
  adminUserDetailResponseSchema,
  adminUsersSearchResponseSchema
} from '../../contracts/admin';
import type { ApiContext } from '../../context';
import { apiError, rethrowApiError } from '../../errors';
import { toPlainWire } from '../../wire.server';
import { siteAdmin } from './shared.server';

const impl = implement(adminContract).$context<ApiContext>();

export const adminUsersImplementation = {
  /** `GET /api/admin/users/{id}` */
  userDetail: impl.userDetail.use(siteAdmin).handler(async ({ input }) => {
    const userId = input.id;

    if (!userId) {
      apiError('BAD_REQUEST', m.user_id_is_required());
    }

    try {
      const db = mongo.db();

      // Get user basic information
      const user = await db.collection('users').findOne({ id: userId });

      if (!user) {
        apiError('NOT_FOUND', m.user_not_found());
      }

      // Get university memberships with university details
      const universityMemberships = (await db
        .collection<UniversityMember>('university_members')
        .aggregate([
          { $match: { userId } },
          {
            $lookup: {
              from: 'universities',
              localField: 'universityId',
              foreignField: 'id',
              as: 'university'
            }
          },
          { $unwind: { path: '$university', preserveNullAndEmptyArrays: true } }
        ])
        .toArray()) as Array<UniversityMember & { university?: University }>;

      // Get club memberships with club details
      const clubMemberships = (await db
        .collection<ClubMember>('club_members')
        .aggregate([
          { $match: { userId } },
          {
            $lookup: {
              from: 'clubs',
              localField: 'clubId',
              foreignField: 'id',
              as: 'club'
            }
          },
          { $unwind: { path: '$club', preserveNullAndEmptyArrays: true } }
        ])
        .toArray()) as Array<ClubMember & { club?: Club }>;

      return toPlainWire(adminUserDetailResponseSchema, {
        user,
        universityMemberships,
        clubMemberships
      });
    } catch (err) {
      rethrowApiError(err, m.failed_to_fetch_user_details());
    }
  }),

  /** `GET /api/admin/users/search` */
  searchUsers: impl.searchUsers.use(siteAdmin).handler(async ({ input }) => {
    const q = input.q;
    const userType = input.userType;
    const page = input.page;
    const limit = input.limit;
    const detailed = input.detailed;

    const db = mongo.db();

    // Build search query
    const searchQuery: Record<string, unknown> = {};

    if (q) {
      // Escaped, for the same reason as the organization search.
      const userPattern = buildSearchPattern(q);
      searchQuery.$or = [
        { id: q },
        { name: { $regex: userPattern, $options: 'i' } },
        { displayName: { $regex: userPattern, $options: 'i' } },
        { email: { $regex: userPattern, $options: 'i' } },
        { phone: { $regex: userPattern, $options: 'i' } }
      ];
    }

    if (userType && userType !== 'all') {
      if (userType === 'regular') {
        const userTypeOr = [{ userType: { $exists: false } }, { userType: undefined }];
        if (searchQuery.$or) {
          searchQuery.$and = [{ $or: searchQuery.$or }, { $or: userTypeOr }];
          delete searchQuery.$or;
        } else {
          searchQuery.$or = userTypeOr;
        }
      } else {
        searchQuery.userType = userType;
      }
    }

    if (!detailed) {
      // Simple mode: used by machine creation modal user picker
      const users = await db
        .collection('users')
        .find(searchQuery)
        .limit(limit)
        .project({ id: 1, name: 1, displayName: 1, email: 1, image: 1 })
        .toArray();

      return toPlainWire(adminUsersSearchResponseSchema, { users });
    }

    // Detailed mode: used by admin user management page
    const skip = (page - 1) * limit;

    const users = (await db
      .collection<User>('users')
      .aggregate([
        { $match: searchQuery },
        {
          $lookup: {
            from: 'university_members',
            localField: 'id',
            foreignField: 'userId',
            as: 'universityMemberships'
          }
        },
        {
          $lookup: {
            from: 'club_members',
            localField: 'id',
            foreignField: 'userId',
            as: 'clubMemberships'
          }
        },
        {
          $addFields: {
            universitiesCount: { $size: '$universityMemberships' },
            clubsCount: { $size: '$clubMemberships' }
          }
        },
        {
          $project: {
            universityMemberships: 0,
            clubMemberships: 0
          }
        },
        { $sort: { joinedAt: -1 } },
        { $skip: skip },
        { $limit: limit + 1 }
      ])
      .toArray()) as Array<
      User & {
        universitiesCount: number;
        clubsCount: number;
      }
    >;

    const hasMore = users.length > limit;
    if (hasMore) {
      users.pop();
    }

    return toPlainWire(adminUsersSearchResponseSchema, {
      users,
      currentPage: page,
      hasMore
    });
  })
};
