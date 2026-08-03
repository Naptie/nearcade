import mongo from '$lib/db/index.server';
import { redirect } from '@sveltejs/kit';
import type { UniversityMember, ClubMember } from '$lib/types';
import type { PageServerLoad } from './$types';
import type { Db } from 'mongodb';

export interface TrendPoint {
  date: string; // YYYY-MM-DD (UTC)
  value: number; // cumulative count at the end of the day
}

const TREND_DAYS = 30;

/**
 * Build a cumulative daily time series for a collection's documents over the
 * last 30 days. The `filter` is applied to both the total and the daily
 * window, so scoped (non-site-admin) statistics get scoped trends too.
 */
async function getTrend(
  db: Db,
  collection: string,
  dateField: string,
  filter: Record<string, unknown> = {}
): Promise<TrendPoint[]> {
  const today = new Date();
  const start = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (TREND_DAYS - 1))
  );

  const total = await db.collection(collection).countDocuments(filter);

  const rows = (await db
    .collection(collection)
    .aggregate([
      { $match: { ...filter, [dateField]: { $gte: start } } },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: `$${dateField}`, timezone: 'UTC' }
          },
          count: { $sum: 1 }
        }
      }
    ])
    .toArray()) as Array<{ _id: string; count: number }>;

  const daily = new Map(rows.map((row) => [row._id, row.count]));

  const points: TrendPoint[] = [];
  let after = 0;
  for (let i = TREND_DAYS - 1; i >= 0; i--) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + i);
    const key = day.toISOString().slice(0, 10);
    points.unshift({ date: key, value: total - after });
    after += daily.get(key) ?? 0;
  }

  return points;
}

export const load: PageServerLoad = async ({ locals }) => {
  const session = locals.session;
  const user = session?.user;

  if (!user) {
    return { stats: null, recentActivity: null, trends: null };
  }

  if (user.userType === 'developer') {
    redirect(302, '/admin/oauth-clients');
  }

  try {
    const db = mongo.db();
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Initialize stats, recent activity and trends objects
    let stats: Record<string, number> = {};
    let recentActivity: Record<string, number> = {};
    let trends: Record<string, TrendPoint[]> = {};

    // For site admins, show all statistics
    if (user.userType === 'site_admin') {
      const [
        totalUsers,
        totalUniversities,
        totalUniversityChangelogs,
        totalClubs,
        totalPosts,
        totalShops,
        totalShopChangelogs,
        totalMachines,
        totalImages,
        totalInvites,
        totalJoinRequests,
        totalOAuthClients,
        totalShopDeleteRequests
      ] = await Promise.all([
        db.collection('users').countDocuments(),
        db.collection('universities').countDocuments(),
        db.collection('changelog').countDocuments({ type: 'university' }),
        db.collection('clubs').countDocuments(),
        db.collection('posts').countDocuments(),
        db.collection('shops').countDocuments(),
        db.collection('shop_changelog').countDocuments(),
        db.collection('machines').countDocuments(),
        db.collection('images').countDocuments(),
        db.collection('invite_links').countDocuments(),
        db.collection('join_requests').countDocuments(),
        db.collection('oauth_clients').countDocuments(),
        db.collection('shop_delete_requests').countDocuments()
      ]);

      const [
        newUsers,
        newClubs,
        newPosts,
        newInvites,
        newJoinRequests,
        newShops,
        newMachines,
        newImages,
        newShopDeleteRequests,
        newOAuthClients,
        newShopChangelogs,
        newUniversityChangelogs
      ] = await Promise.all([
        db.collection('users').countDocuments({ joinedAt: { $gte: oneWeekAgo } }),
        db.collection('clubs').countDocuments({ createdAt: { $gte: oneWeekAgo } }),
        db.collection('posts').countDocuments({ createdAt: { $gte: oneWeekAgo } }),
        db.collection('invite_links').countDocuments({ createdAt: { $gte: oneWeekAgo } }),
        db.collection('join_requests').countDocuments({ createdAt: { $gte: oneWeekAgo } }),
        db.collection('shops').countDocuments({ createdAt: { $gte: oneWeekAgo } }),
        db.collection('machines').countDocuments({ createdAt: { $gte: oneWeekAgo } }),
        db.collection('images').countDocuments({ uploadedAt: { $gte: oneWeekAgo } }),
        db.collection('shop_delete_requests').countDocuments({ createdAt: { $gte: oneWeekAgo } }),
        db.collection('oauth_clients').countDocuments({ createdAt: { $gte: oneWeekAgo } }),
        db.collection('shop_changelog').countDocuments({ createdAt: { $gte: oneWeekAgo } }),
        db
          .collection('changelog')
          .countDocuments({ type: 'university', createdAt: { $gte: oneWeekAgo } })
      ]);

      const [
        trendUsers,
        trendUniversities,
        trendUniversityChangelogs,
        trendClubs,
        trendPosts,
        trendShops,
        trendShopChangelogs,
        trendMachines,
        trendImages,
        trendInvites,
        trendJoinRequests,
        trendShopDeleteRequests,
        trendOAuthClients
      ] = await Promise.all([
        getTrend(db, 'users', 'joinedAt'),
        getTrend(db, 'changelog', 'createdAt', { type: 'university' }),
        getTrend(db, 'changelog', 'createdAt', { type: 'university' }),
        getTrend(db, 'clubs', 'createdAt'),
        getTrend(db, 'posts', 'createdAt'),
        getTrend(db, 'shops', 'createdAt'),
        getTrend(db, 'shop_changelog', 'createdAt'),
        getTrend(db, 'machines', 'createdAt'),
        getTrend(db, 'images', 'uploadedAt'),
        getTrend(db, 'invite_links', 'createdAt'),
        getTrend(db, 'join_requests', 'createdAt'),
        getTrend(db, 'shop_delete_requests', 'createdAt'),
        getTrend(db, 'oauth_clients', 'createdAt')
      ]);

      stats = {
        totalUsers,
        totalUniversities,
        totalUniversityChangelogs,
        totalClubs,
        totalPosts,
        totalShops,
        totalShopChangelogs,
        totalMachines,
        totalImages,
        totalInvites,
        totalJoinRequests,
        totalOAuthClients,
        totalShopDeleteRequests
      };

      recentActivity = {
        newUsers,
        newClubs,
        newPosts,
        newInvites,
        newJoinRequests,
        newShops,
        newMachines,
        newImages,
        newShopDeleteRequests,
        newOAuthClients,
        newShopChangelogs,
        newUniversityChangelogs
      };

      trends = {
        totalUsers: trendUsers,
        // Universities have no creation date, so their chart shows the
        // university changelog history instead.
        totalUniversities: trendUniversities,
        totalUniversityChangelogs: trendUniversityChangelogs,
        totalClubs: trendClubs,
        totalPosts: trendPosts,
        totalShops: trendShops,
        totalShopChangelogs: trendShopChangelogs,
        totalMachines: trendMachines,
        totalImages: trendImages,
        totalInvites: trendInvites,
        totalJoinRequests: trendJoinRequests,
        totalShopDeleteRequests: trendShopDeleteRequests,
        totalOAuthClients: trendOAuthClients
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

      // Changelog entries for universities the user can manage
      const universityChangelogFilter =
        managedUniversityIds.length > 0
          ? { type: 'university', targetId: { $in: managedUniversityIds } }
          : { _nonExistentField: true };

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
      const joinRequestFilter =
        permissionFilter.$or?.length > 0 ? permissionFilter : { _nonExistentField: true };

      // Build post filter for posts user can manage
      const postOrConditions: object[] = [];
      if (managedUniversityIds.length > 0) {
        postOrConditions.push({ universityId: { $in: managedUniversityIds } });
      }
      if (managedClubIds.length > 0) {
        postOrConditions.push({ clubId: { $in: managedClubIds } });
      }
      const postFilter =
        postOrConditions.length > 0 ? { $or: postOrConditions } : { _nonExistentField: true };

      const [
        totalUniversities,
        totalUniversityChangelogs,
        totalClubs,
        totalPosts,
        totalInvites,
        totalJoinRequests,
        newClubs,
        newPosts,
        newInvites,
        newJoinRequests,
        newUniversityChangelogs,
        trendUniversities,
        trendUniversityChangelogs,
        trendClubs,
        trendPosts,
        trendInvites,
        trendJoinRequests
      ] = await Promise.all([
        db.collection('universities').countDocuments(universityFilter),
        db.collection('changelog').countDocuments(universityChangelogFilter),
        db.collection('clubs').countDocuments(clubFilter),
        db.collection('posts').countDocuments(postFilter),
        db.collection('invite_links').countDocuments(inviteFilter),
        db.collection('join_requests').countDocuments(joinRequestFilter),
        db.collection('clubs').countDocuments({
          ...clubFilter,
          createdAt: { $gte: oneWeekAgo }
        }),
        db.collection('posts').countDocuments({
          ...postFilter,
          createdAt: { $gte: oneWeekAgo }
        }),
        db.collection('invite_links').countDocuments({
          ...inviteFilter,
          createdAt: { $gte: oneWeekAgo }
        }),
        db.collection('join_requests').countDocuments({
          ...(permissionFilter.$or?.length > 0 ? permissionFilter : { _nonExistentField: true }),
          createdAt: { $gte: oneWeekAgo }
        }),
        db.collection('changelog').countDocuments({
          ...universityChangelogFilter,
          createdAt: { $gte: oneWeekAgo }
        }),
        getTrend(db, 'changelog', 'createdAt', universityChangelogFilter),
        getTrend(db, 'changelog', 'createdAt', universityChangelogFilter),
        getTrend(db, 'clubs', 'createdAt', clubFilter),
        getTrend(db, 'posts', 'createdAt', postFilter),
        getTrend(db, 'invite_links', 'createdAt', inviteFilter),
        getTrend(
          db,
          'join_requests',
          'createdAt',
          permissionFilter.$or?.length > 0 ? permissionFilter : { _nonExistentField: true }
        )
      ]);

      stats = {
        totalUniversities,
        totalUniversityChangelogs,
        totalClubs,
        totalPosts,
        totalInvites,
        totalJoinRequests
      };

      recentActivity = {
        newClubs,
        newPosts,
        newInvites,
        newJoinRequests,
        newUniversityChangelogs
      };

      trends = {
        // Universities have no creation date, so their chart shows the
        // university changelog history instead.
        totalUniversities: trendUniversities,
        totalUniversityChangelogs: trendUniversityChangelogs,
        totalClubs: trendClubs,
        totalPosts: trendPosts,
        totalInvites: trendInvites,
        totalJoinRequests: trendJoinRequests
      };
    }

    return {
      stats,
      recentActivity,
      trends
    };
  } catch (err) {
    console.error('Error loading admin dashboard:', err);
    return {
      stats: null,
      recentActivity: null,
      trends: null
    };
  }
};
