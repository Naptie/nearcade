import client from '$lib/db.server';
import type { UniversityMember, ClubMember } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const session = await locals.auth();
  const user = session?.user;

  if (!user) {
    return { stats: null };
  }

  try {
    const db = client.db();
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Initialize stats and recent activity objects
    let stats: Record<string, number> = {};
    let recentActivity: Record<string, number> = {};

    // For site admins, show all statistics
    if (user.userType === 'site_admin') {
      stats = {
        totalUsers: await db.collection('users').countDocuments(),
        totalUniversities: await db.collection('universities').countDocuments(),
        totalClubs: await db.collection('clubs').countDocuments(),
        totalShops: await db.collection('shops').countDocuments(),
        totalInvites: await db.collection('invite_links').countDocuments(),
        pendingJoinRequests: await db
          .collection('join_requests')
          .countDocuments({ status: 'pending' })
      };

      recentActivity = {
        newUsers: await db.collection('users').countDocuments({
          joinedAt: { $gte: oneWeekAgo }
        }),
        newClubs: await db.collection('clubs').countDocuments({
          createdAt: { $gte: oneWeekAgo }
        }),
        newInvites: await db.collection('invite_links').countDocuments({
          createdAt: { $gte: oneWeekAgo }
        }),
        newJoinRequests: await db.collection('join_requests').countDocuments({
          createdAt: { $gte: oneWeekAgo }
        })
      };
    } else {
      // For non-site admins, apply scope-based filtering
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

      // Count universities user can manage
      const universityFilter =
        managedUniversityIds.length > 0
          ? { id: { $in: managedUniversityIds } }
          : { _nonExistentField: true }; // No results if no managed universities

      // Count clubs user can manage
      const clubFilter =
        managedClubIds.length > 0 ? { id: { $in: managedClubIds } } : { _nonExistentField: true }; // No results if no managed clubs

      // Build permission filter for invites and join requests
      const permissionFilter = {
        $or: [
          ...(managedClubIds.length > 0
            ? [{ type: 'club', targetId: { $in: managedClubIds } }]
            : []),
          ...(managedUniversityIds.length > 0
            ? [{ type: 'university', targetId: { $in: managedUniversityIds } }]
            : [])
        ]
      };

      // Get scoped statistics
      const inviteFilter =
        permissionFilter.$or?.length > 0 ? permissionFilter : { _nonExistentField: true };
      const joinRequestFilter = {
        ...(permissionFilter.$or?.length > 0 ? permissionFilter : { _nonExistentField: true }),
        status: 'pending'
      };

      const [
        totalUniversities,
        totalClubs,
        totalInvites,
        pendingJoinRequests,
        newClubs,
        newInvites,
        newJoinRequests
      ] = await Promise.all([
        db.collection('universities').countDocuments(universityFilter),
        db.collection('clubs').countDocuments(clubFilter),
        db.collection('invite_links').countDocuments(inviteFilter),
        db.collection('join_requests').countDocuments(joinRequestFilter),
        db.collection('clubs').countDocuments({
          ...clubFilter,
          createdAt: { $gte: oneWeekAgo }
        }),
        db.collection('invite_links').countDocuments({
          ...inviteFilter,
          createdAt: { $gte: oneWeekAgo }
        }),
        db.collection('join_requests').countDocuments({
          ...(permissionFilter.$or?.length > 0 ? permissionFilter : { _nonExistentField: true }),
          createdAt: { $gte: oneWeekAgo }
        })
      ]);

      stats = {
        totalUniversities,
        totalClubs,
        totalInvites,
        pendingJoinRequests
      };

      recentActivity = {
        newClubs,
        newInvites,
        newJoinRequests
      };
    }

    return {
      stats,
      recentActivity
    };
  } catch (err) {
    console.error('Error loading admin dashboard:', err);
    return {
      stats: null,
      recentActivity: null
    };
  }
};
