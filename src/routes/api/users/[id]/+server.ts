import { error, isHttpError, isRedirect, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { User } from '$lib/auth/types';
import type { Shop } from '$lib/types';
import mongo from '$lib/db/index.server';
import { toPlainArray, toPlainObject } from '$lib/utils';
import { m } from '$lib/paraglide/messages';
import { userProfileResponseSchema, userRouteIdParamSchema } from '$lib/schemas/users';
import { parseParamsOrError } from '$lib/utils/validation.server';

export const GET: RequestHandler = async ({ params, locals }) => {
  const session = locals.session;
  const { id } = parseParamsOrError(userRouteIdParamSchema, params);

  try {
    const db = mongo.db();
    const usersCollection = db.collection<User>('users');

    let user: User | null;
    if (id.startsWith('@')) {
      const username = id.slice(1);
      user = await usersCollection.findOne({ name: username });
    } else {
      user = await usersCollection.findOne({ id });
    }

    if (!user) {
      error(404, m.user_not_found());
    }

    const canViewAll = session?.user?.id === user.id || session?.user?.userType === 'site_admin';

    let universityMembership: {
      verifiedAt?: Date;
      joinedAt: Date;
      university: {
        id: string;
        slug?: string;
        name: string;
      };
    } | null = null;

    const universityMembersCollection = db.collection('university_members');
    const universityMembershipCount = await universityMembersCollection.countDocuments({
      userId: user.id
    });
    const clubMembershipCount = await db.collection('club_members').countDocuments({
      userId: user.id
    });

    if (canViewAll || user.isUniversityPublic) {
      const result = await universityMembersCollection
        .aggregate<{
          verifiedAt?: Date;
          joinedAt: Date;
          university: {
            id: string;
            slug?: string;
            name: string;
          };
        }>([
          { $match: { userId: user.id } },
          { $sort: { joinedAt: -1 } },
          { $limit: 1 },
          {
            $lookup: {
              from: 'universities',
              localField: 'universityId',
              foreignField: 'id',
              as: 'university'
            }
          },
          { $unwind: '$university' },
          {
            $project: {
              verifiedAt: 1,
              joinedAt: 1,
              'university.id': 1,
              'university.slug': 1,
              'university.name': 1
            }
          }
        ])
        .toArray();

      if (result.length > 0 && result[0].university) {
        universityMembership = {
          verifiedAt: result[0].verifiedAt,
          joinedAt: result[0].joinedAt,
          university: result[0].university
        };
      }
    }

    let frequentingArcades: Shop[] = [];
    let starredArcades: Shop[] = [];

    if (canViewAll || user.isFrequentingArcadePublic !== false) {
      const frequentingArcadeIds = user.frequentingArcades || [];
      if (frequentingArcadeIds.length > 0) {
        frequentingArcades = await db
          .collection<Shop>('shops')
          .find({
            id: { $in: frequentingArcadeIds }
          })
          .toArray();
      }
    }

    if (canViewAll || user.isStarredArcadePublic !== false) {
      const starredArcadeIds = user.starredArcades || [];
      if (starredArcadeIds.length > 0) {
        starredArcades = await db
          .collection<Shop>('shops')
          .find({
            id: { $in: starredArcadeIds }
          })
          .toArray();
      }
    }

    return json(
      userProfileResponseSchema.parse(
        toPlainObject({
          user: {
            id: user.id,
            name: user.name,
            displayName: user.displayName,
            image: user.image,
            bio: user.bio,
            userType: user.userType,
            joinedAt: user.joinedAt,
            lastActiveAt: user.lastActiveAt,
            email: canViewAll || user.isEmailPublic ? (user.email ?? null) : null,
            frequentingArcades: toPlainArray(frequentingArcades),
            starredArcades: toPlainArray(starredArcades),
            isActivityPublic: user.isActivityPublic,
            socialLinks: user.socialLinks || []
          },
          frequentingArcadesCount: user.frequentingArcades ? user.frequentingArcades.length : 0,
          starredArcadesCount: user.starredArcades ? user.starredArcades.length : 0,
          universityMembershipCount,
          clubMembershipCount,
          universityMembership,
          isOwnProfile: session?.user?.id === user.id
        })
      )
    );
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error loading user profile:', err);
    error(500, m.failed_to_load_user_profile());
  }
};
