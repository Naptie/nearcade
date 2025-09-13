import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { InviteLink } from '$lib/types';
import { toPlainArray } from '$lib/utils';
import mongo from '$lib/db/index.server';

export const load: PageServerLoad = async ({ locals, url }) => {
  const session = await locals.auth();

  if (!session?.user) {
    return fail(401, { error: 'Unauthorized' });
  }

  const search = url.searchParams.get('search') || '';
  const status = url.searchParams.get('status') || 'all';
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = 20;
  const skip = (page - 1) * limit;

  const db = mongo.db();

  // Build search query
  const searchQuery: Record<string, unknown> = {};

  if (search.trim()) {
    searchQuery.$or = [
      { code: { $regex: search.trim(), $options: 'i' } },
      { 'club.name': { $regex: search.trim(), $options: 'i' } },
      { 'university.name': { $regex: search.trim(), $options: 'i' } },
      { 'creator.displayName': { $regex: search.trim(), $options: 'i' } },
      { 'creator.name': { $regex: search.trim(), $options: 'i' } }
    ];
  }

  // Filter by status
  if (status === 'active') {
    searchQuery.$and = [
      { $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] },
      { $or: [{ maxUses: null }, { $expr: { $lt: ['$currentUses', '$maxUses'] } }] }
    ];
  } else if (status === 'unused') {
    searchQuery.$and = [{ currentUses: { $eq: 0 } }];
  } else if (status === 'expired') {
    searchQuery.$nor = [
      {
        $and: [
          { $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] },
          { $or: [{ maxUses: null }, { $expr: { $lt: ['$currentUses', '$maxUses'] } }] }
        ]
      }
    ];
  }

  // For non-site admins, filter by permissions
  let permissionFilter = {};
  if (session.user.userType !== 'site_admin') {
    // Get user's club/university memberships where they have admin/moderator role
    const [clubMemberships, universityMemberships] = await Promise.all([
      db
        .collection('club_members')
        .find({
          userId: session.user.id,
          $or: [{ memberType: 'admin' }, { memberType: 'moderator' }]
        })
        .toArray(),
      db
        .collection('university_members')
        .find({
          userId: session.user.id,
          $or: [{ memberType: 'admin' }, { memberType: 'moderator' }]
        })
        .toArray()
    ]);

    const clubIds = clubMemberships.map((m: Record<string, unknown>) => m.clubId);
    const universityIds = universityMemberships.map((m: Record<string, unknown>) => m.universityId);

    if (clubIds.length === 0 && universityIds.length === 0) {
      // User has no admin privileges
      return {
        invites: [],
        search,
        status,
        currentPage: page,
        hasMore: false,
        inviteStats: { total: 0, active: 0, expired: 0, unused: 0 }
      };
    }

    permissionFilter = {
      $or: [{ clubId: { $in: clubIds } }, { universityId: { $in: universityIds } }]
    };
  }

  // Combine search and permission filters
  const finalQuery =
    permissionFilter && Object.keys(permissionFilter).length > 0
      ? { $and: [searchQuery, permissionFilter] }
      : searchQuery;

  // Fetch invites with populated club/university data
  const invites = (await db
    .collection<InviteLink>('invite_links')
    .aggregate([
      {
        $lookup: {
          from: 'clubs',
          localField: 'targetId',
          foreignField: 'id',
          as: 'club'
        }
      },
      {
        $lookup: {
          from: 'universities',
          localField: 'targetId',
          foreignField: 'id',
          as: 'university'
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'createdBy',
          foreignField: 'id',
          as: 'creator'
        }
      },
      { $match: finalQuery },
      {
        $addFields: {
          club: { $arrayElemAt: ['$club', 0] },
          university: { $arrayElemAt: ['$university', 0] },
          creator: { $arrayElemAt: ['$creator', 0] }
        }
      },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit + 1 } // Fetch one extra to check if there are more
    ])
    .toArray()) as Array<
    InviteLink & {
      clubId?: string;
      universityId?: string;
      club?: { id: string; name: string };
      university?: { id: string; name: string };
      creator?: { id: string; name?: string; displayName?: string };
    }
  >;

  const hasMore = invites.length > limit;
  if (hasMore) {
    invites.pop(); // Remove the extra item
  }

  // Get invite statistics
  const stats = await db
    .collection('invite_links')
    .aggregate([
      {
        $match: permissionFilter && Object.keys(permissionFilter).length > 0 ? permissionFilter : {}
      },
      {
        $facet: {
          total: [{ $count: 'count' }],
          active: [
            {
              $match: {
                $and: [
                  { $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] },
                  { $or: [{ maxUses: null }, { $expr: { $lt: ['$currentUses', '$maxUses'] } }] }
                ]
              }
            },
            { $count: 'count' }
          ],
          unused: [{ $match: { currentUses: { $eq: 0 } } }, { $count: 'count' }]
        }
      }
    ])
    .toArray();

  const inviteStats = {
    total: stats[0]?.total[0]?.count || 0,
    active: stats[0]?.active[0]?.count || 0,
    unused: stats[0]?.unused[0]?.count || 0,
    expired: 0
  };

  inviteStats.expired = inviteStats.total - inviteStats.active;

  return {
    invites: toPlainArray(invites),
    search,
    status,
    currentPage: page,
    hasMore,
    inviteStats
  };
};

export const actions: Actions = {
  delete: async ({ request, locals }) => {
    const session = await locals.auth();

    if (!session?.user) {
      return fail(401, { error: 'Unauthorized' });
    }

    const formData = await request.formData();
    const inviteId = formData.get('inviteId') as string;

    if (!inviteId) {
      return fail(400, { error: 'Invite ID is required' });
    }

    try {
      const db = mongo.db();

      // Get invite details
      const invite = await db.collection('invite_links').findOne({ id: inviteId });
      if (!invite) {
        return fail(404, { error: 'Invite not found' });
      }

      // Check permissions
      if (session.user.userType !== 'site_admin') {
        // Check if user can manage this invite
        const canManage = invite.createdBy === session.user.id;

        if (!canManage) {
          // Check if user has admin/moderator role in the club/university
          const hasPermission =
            (await db.collection('club_members').findOne({
              userId: session.user.id,
              clubId: invite.clubId,
              $or: [{ memberType: 'admin' }, { memberType: 'moderator' }]
            })) ||
            (await db.collection('university_members').findOne({
              userId: session.user.id,
              universityId: invite.universityId,
              $or: [{ memberType: 'admin' }, { memberType: 'moderator' }]
            }));

          if (!hasPermission) {
            return fail(403, { error: 'Access denied' });
          }
        }
      }

      // Delete the invite
      await db.collection('invite_links').deleteOne({ id: inviteId });

      return { success: true };
    } catch (error) {
      console.error('Error deleting invite:', error);
      return fail(500, { error: 'Failed to delete invite' });
    }
  }
};
