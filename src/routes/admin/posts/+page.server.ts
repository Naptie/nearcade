import client from '$lib/db.server';
import type { PageServerLoad } from './$types';
import type { UniversityMember, ClubMember } from '$lib/types';
import { toPlainArray } from '$lib/utils';

export const load: PageServerLoad = async ({ locals, url }) => {
  const session = await locals.auth();
  const user = session?.user;

  if (!user) {
    return { posts: [], totalCount: 0, hasMore: false };
  }

  try {
    const db = client.db();
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = 20;
    const skip = (page - 1) * limit;

    let postFilter: object = {};

    // For non-site admins, apply scope-based filtering
    if (user.userType !== 'site_admin') {
      // Get user's club/university memberships where they have admin/moderator role
      const [clubMemberships, universityMemberships] = await Promise.all([
        db
          .collection<ClubMember>('club_members')
          .find({
            userId: user.id,
            memberType: { $in: ['admin', 'moderator'] }
          })
          .toArray(),
        db
          .collection<UniversityMember>('university_members')
          .find({
            userId: user.id,
            memberType: { $in: ['admin', 'moderator'] }
          })
          .toArray()
      ]);

      const managedClubIds = clubMemberships.map((m) => m.clubId);
      const managedUniversityIds = universityMemberships.map((m) => m.universityId);

      // Build filter for posts user can manage
      const orConditions: object[] = [];

      if (managedUniversityIds.length > 0) {
        orConditions.push({ universityId: { $in: managedUniversityIds } });
      }

      if (managedClubIds.length > 0) {
        orConditions.push({ clubId: { $in: managedClubIds } });
      }

      if (orConditions.length === 0) {
        // User has no management permissions
        return { posts: [], totalCount: 0, hasMore: false };
      }

      postFilter = { $or: orConditions };
    }

    // Get posts with author and organization info
    const postsAggregation = [
      {
        $match: postFilter
      },
      {
        $lookup: {
          from: 'users',
          localField: 'createdBy',
          foreignField: 'id',
          as: 'authorData'
        }
      },
      {
        $lookup: {
          from: 'universities',
          localField: 'universityId',
          foreignField: 'id',
          as: 'universityData'
        }
      },
      {
        $lookup: {
          from: 'clubs',
          localField: 'clubId',
          foreignField: 'id',
          as: 'clubData'
        }
      },
      {
        $addFields: {
          author: { $arrayElemAt: ['$authorData', 0] },
          university: { $arrayElemAt: ['$universityData', 0] },
          club: { $arrayElemAt: ['$clubData', 0] }
        }
      },
      {
        $project: {
          authorData: 0,
          universityData: 0,
          clubData: 0,
          'author.email': 0,
          'author._id': 0
        }
      },
      {
        $sort: { createdAt: -1 }
      }
    ];

    const [posts, totalCount] = await Promise.all([
      db
        .collection('posts')
        .aggregate([
          ...postsAggregation,
          { $skip: skip },
          { $limit: limit + 1 } // Get one extra to check if there's more
        ])
        .toArray(),
      db.collection('posts').countDocuments(postFilter)
    ]);

    const hasMore = posts.length > limit;
    if (hasMore) {
      posts.pop(); // Remove extra item
    }

    return {
      posts: toPlainArray(posts),
      totalCount,
      hasMore,
      page
    };
  } catch (err) {
    console.error('Error loading admin posts:', err);
    return { posts: [], totalCount: 0, hasMore: false };
  }
};
