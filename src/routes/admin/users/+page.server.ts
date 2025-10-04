import { error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { toPlainArray, updateUserType } from '$lib/utils';
import type { User } from '@auth/sveltekit';
import { nanoid } from 'nanoid';
import mongo from '$lib/db/index.server';
import { USER_TYPES } from '$lib/constants';

export const load: PageServerLoad = async ({ locals, url }) => {
  const session = await locals.auth();

  if (!session?.user) {
    error(401, 'Unauthorized');
  }

  // Only site admins can manage users
  if (session.user.userType !== 'site_admin') {
    return fail(403, { error: 'Access denied' });
  }

  const search = url.searchParams.get('search') || '';
  const userType = url.searchParams.get('userType') || '';
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = 20;
  const skip = (page - 1) * limit;

  const db = mongo.db();

  // Build search query
  const searchQuery: Record<string, unknown> = {};

  if (search.trim()) {
    searchQuery.$or = [
      { name: { $regex: search.trim(), $options: 'i' } },
      { displayName: { $regex: search.trim(), $options: 'i' } },
      { email: { $regex: search.trim(), $options: 'i' } }
    ];
  }

  if (userType && userType !== 'all') {
    if (userType === 'regular') {
      // Match users where userType is missing or undefined
      const userTypeOr = [{ userType: { $exists: false } }, { userType: undefined }];
      if (searchQuery.$or) {
        // Combine both $or conditions using $and
        searchQuery.$and = [{ $or: searchQuery.$or }, { $or: userTypeOr }];
        delete searchQuery.$or;
      } else {
        searchQuery.$or = userTypeOr;
      }
    } else if (userType) {
      searchQuery.userType = userType;
    }
  }

  // Fetch users with their affiliations
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
      { $sort: { joinedAt: -1 } },
      { $skip: skip },
      { $limit: limit + 1 } // Fetch one extra to check if there are more
    ])
    .toArray()) as Array<
    User & {
      universitiesCount: number;
      clubsCount: number;
    }
  >;

  const hasMore = users.length > limit;
  if (hasMore) {
    users.pop(); // Remove the extra item
  }

  // Get user type statistics
  const userTypeStats = await db
    .collection('users')
    .aggregate([
      {
        $group: {
          _id: '$userType',
          count: { $sum: 1 }
        }
      }
    ])
    .toArray();

  // Get universities and clubs for role management
  const [universities, clubs] = await Promise.all([
    db
      .collection('universities')
      .find({})
      .sort({ name: 1 })
      .collation({ locale: 'zh@collation=gb2312han' })
      .toArray(),
    db
      .collection('clubs')
      .find({})
      .sort({ name: 1 })
      .collation({ locale: 'zh@collation=gb2312han' })
      .toArray()
  ]);

  const countsMap = Object.fromEntries(
    userTypeStats.map((stat) => [stat._id || 'regular', stat.count])
  );

  return {
    users: toPlainArray(users),
    universities: toPlainArray(universities),
    clubs: toPlainArray(clubs),
    search,
    userType,
    currentPage: page,
    hasMore,
    userTypeStats: Object.fromEntries(USER_TYPES.map((k) => [k, countsMap[k] ?? 0]))
  };
};

export const actions: Actions = {
  updateOrganizationRole: async ({ request, locals }) => {
    const session = await locals.auth();

    if (!session?.user) {
      return fail(401, { error: 'Unauthorized' });
    }

    // Only site admins can update organization roles
    if (session.user.userType !== 'site_admin') {
      return fail(403, { error: 'Access denied' });
    }

    const formData = await request.formData();
    const userId = formData.get('userId') as string;
    const organizationType = formData.get('organizationType') as string;
    const organizationId = formData.get('organizationId') as string;
    const memberType = formData.get('memberType') as string;
    const action = formData.get('action') as string;

    if (!userId || !organizationType || !organizationId || !action) {
      return fail(400, { error: 'Missing required fields' });
    }

    if (!['university', 'club'].includes(organizationType)) {
      return fail(400, { error: 'Invalid organization type' });
    }

    try {
      const db = mongo.db();

      const collectionName =
        organizationType === 'university' ? 'university_members' : 'club_members';
      const organizationKey = organizationType === 'university' ? 'universityId' : 'clubId';

      if (action === 'add') {
        if (!memberType) {
          return fail(400, { error: 'Member type required' });
        }

        const validMemberTypes =
          organizationType === 'university'
            ? ['student', 'moderator', 'admin']
            : ['member', 'moderator', 'admin'];

        if (!validMemberTypes.includes(memberType)) {
          return fail(400, { error: 'Invalid member type' });
        }

        // Check if membership already exists
        const existingMembership = await db.collection(collectionName).findOne({
          userId,
          [organizationKey]: organizationId
        });

        if (existingMembership) {
          // Update existing membership instead of creating new one
          await db
            .collection(collectionName)
            .updateOne({ userId, [organizationKey]: organizationId }, { $set: { memberType } });
        } else {
          // Create new membership
          await db.collection(collectionName).insertOne({
            id: nanoid(),
            userId,
            [organizationKey]: organizationId,
            memberType,
            joinedAt: new Date()
          });
        }
      } else if (action === 'update') {
        if (!memberType) {
          return fail(400, { error: 'Member type required' });
        }

        const validMemberTypes =
          organizationType === 'university'
            ? ['student', 'moderator', 'admin']
            : ['member', 'moderator', 'admin'];

        if (!validMemberTypes.includes(memberType)) {
          return fail(400, { error: 'Invalid member type' });
        }

        await db
          .collection(collectionName)
          .updateOne({ userId, [organizationKey]: organizationId }, { $set: { memberType } });
      } else if (action === 'remove') {
        await db.collection(collectionName).deleteOne({
          userId,
          [organizationKey]: organizationId
        });
      }

      await updateUserType(userId, mongo);
      return { success: true };
    } catch (error) {
      console.error('Error updating organization role:', error);
      return fail(500, { error: 'Failed to update organization role' });
    }
  },

  deleteUser: async ({ request, locals }) => {
    const session = await locals.auth();

    if (!session?.user) {
      return fail(401, { error: 'Unauthorized' });
    }

    // Only site admins can delete users
    if (session.user.userType !== 'site_admin') {
      return fail(403, { error: 'Access denied' });
    }

    const formData = await request.formData();
    const userId = formData.get('userId') as string;

    if (!userId) {
      return fail(400, { error: 'User ID is required' });
    }

    // Prevent self-deletion
    if (userId === session.user.id) {
      return fail(400, { error: 'Cannot delete your own account' });
    }

    try {
      const db = mongo.db();

      // Check if user exists
      const user = await db.collection('users').findOne({ id: userId });
      if (!user) {
        return fail(404, { error: 'User not found' });
      }

      // Delete user and all related data
      await Promise.all([
        // Delete the user
        db.collection('users').deleteOne({ id: userId }),
        // Delete user's accounts (auth providers)
        db.collection('accounts').deleteMany({ userId: user._id }),
        // Delete user's sessions
        db.collection('sessions').deleteMany({ userId: user._id }),
        // Delete university memberships
        db.collection('university_members').deleteMany({ userId }),
        // Delete club memberships
        db.collection('club_members').deleteMany({ userId }),
        // Delete join requests
        db.collection('join_requests').deleteMany({ userId })
      ]);

      return { success: true };
    } catch (error) {
      console.error('Error deleting user:', error);
      return fail(500, { error: 'Failed to delete user' });
    }
  }
};
