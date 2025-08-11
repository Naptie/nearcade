import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { User } from '@auth/sveltekit';
import type { University, UniversityMember, Shop } from '$lib/types';
import client from '$lib/db.server';
import { toPlainArray } from '$lib/utils';

export const load: PageServerLoad = async ({ params, locals }) => {
  const session = await locals.auth();
  const { id } = params;

  try {
    const db = client.db();
    const usersCollection = db.collection<User>('users');

    // Get user data
    let user: User | null;
    if (id.startsWith('@')) {
      const username = id.slice(1);
      user = await usersCollection.findOne({ name: username });
    } else {
      user = await usersCollection.findOne({ id });
    }

    if (!user) {
      error(404, 'User not found');
    }

    const canViewAll = session?.user?.id === user.id || session?.user?.userType === 'site_admin';

    // Get university info if user belongs to one, using aggregation for efficiency
    let universityMembership: {
      verifiedAt?: Date;
      joinedAt: Date;
      university: Pick<University, 'id' | 'slug' | 'name'>;
    } | null = null;
    const universityMembersCollection = db.collection<UniversityMember>('university_members');
    const universityMembershipCount = await universityMembersCollection.countDocuments({
      userId: user.id
    });
    const clubMembershipCount = await db.collection('club_members').countDocuments({
      userId: user.id
    });

    if (canViewAll || user.isUniversityPublic) {
      const pipeline = [
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
      ];

      const result = await universityMembersCollection.aggregate(pipeline).toArray();
      if (result.length > 0 && result[0].university) {
        universityMembership = {
          verifiedAt: result[0].verifiedAt,
          joinedAt: result[0].joinedAt,
          university: {
            id: result[0].university.id,
            slug: result[0].university.slug,
            name: result[0].university.name
          }
        };
      }
    }

    // Get arcade data based on privacy settings
    let frequentingArcades: Shop[] = [];
    let starredArcades: Shop[] = [];

    if (canViewAll || user.isFrequentingArcadePublic !== false) {
      const frequentingArcadeIds = user.frequentingArcades || [];
      if (frequentingArcadeIds.length > 0) {
        const shopsCollection = db.collection<Shop>('shops');
        frequentingArcades = await shopsCollection
          .find({ id: { $in: frequentingArcadeIds } })
          .toArray();
      }
    }

    if (canViewAll || user.isStarredArcadePublic !== false) {
      const starredArcadeIds = user.starredArcades || [];
      if (starredArcadeIds.length > 0) {
        const shopsCollection = db.collection<Shop>('shops');
        starredArcades = await shopsCollection.find({ id: { $in: starredArcadeIds } }).toArray();
      }
    }

    return {
      user: {
        id: user.id,
        name: user.name,
        displayName: user.displayName,
        image: user.image,
        bio: user.bio,
        userType: user.userType,
        joinedAt: user.joinedAt,
        lastActiveAt: user.lastActiveAt,
        email: canViewAll || user.isEmailPublic ? user.email : null,
        frequentingArcades: toPlainArray(frequentingArcades),
        starredArcades: toPlainArray(starredArcades),
        isActivityPublic: user.isActivityPublic
      },
      frequentingArcadesCount: user.frequentingArcades ? user.frequentingArcades.length : 0,
      starredArcadesCount: user.starredArcades ? user.starredArcades.length : 0,
      universityMembershipCount,
      clubMembershipCount,
      universityMembership,
      isOwnProfile: session?.user?.id === user.id
    };
  } catch (err) {
    console.error('Error loading user profile:', err);
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    error(500, 'Failed to load user profile');
  }
};
