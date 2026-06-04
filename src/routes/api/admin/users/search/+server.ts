import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { toPlainArray } from '$lib/utils';
import type { User } from '$lib/auth/types';

export const GET: RequestHandler = async ({ locals, url }) => {
  const session = locals.session;

  if (!session?.user) {
    error(401, m.unauthorized());
  }

  if (session.user.userType !== 'site_admin') {
    error(403, m.access_denied());
  }

  const q = url.searchParams.get('q')?.trim() ?? '';
  const userType = url.searchParams.get('userType')?.trim() ?? '';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '10')));
  const detailed = url.searchParams.get('detailed') === 'true';

  const db = mongo.db();

  // Build search query
  const searchQuery: Record<string, unknown> = {};

  if (q) {
    searchQuery.$or = [
      { id: q },
      { name: { $regex: q, $options: 'i' } },
      { displayName: { $regex: q, $options: 'i' } },
      { email: { $regex: q, $options: 'i' } },
      { phone: { $regex: q, $options: 'i' } }
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

    return json({ users: toPlainArray(users) });
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

  return json({
    users: toPlainArray(users),
    currentPage: page,
    hasMore
  });
};
