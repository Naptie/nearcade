import mongo from '$lib/db/index.server';
import { redirect } from '@sveltejs/kit';
import type { UniversityMember, ClubMember } from '$lib/types';
import type { PageServerLoad } from './$types';
import {
  getAdminStatsSnapshotView,
  maybeCaptureStaleAdminStatsSnapshot,
  snapshotSeriesToTrend,
  type PeriodDelta,
  type SnapshotSeriesPoint,
  type StatsMetric
} from '$lib/admin/stats-snapshots.server';

export interface TrendPoint {
  date: string; // YYYY-MM-DD (UTC)
  value: number;
}

export type MetricDelta = PeriodDelta;

export interface AdminDashboardSnapshotMeta {
  capturedAt: string | null;
  prevDate: string | null;
  periodDays: number;
  baseline: boolean;
}

export interface AdminDashboardData {
  stats: Record<string, number> | null;
  /** Period (default 7d) exact add/remove sums from daily snapshot diffs. */
  deltas: Record<string, MetricDelta> | null;
  trends: Record<string, TrendPoint[]> | null;
  snapshotMeta: AdminDashboardSnapshotMeta | null;
}

const toTrend = (series: SnapshotSeriesPoint[], metric: StatsMetric): TrendPoint[] =>
  snapshotSeriesToTrend(series, metric);

export const load: PageServerLoad = async ({ locals }): Promise<AdminDashboardData> => {
  const session = locals.session;
  const user = session?.user;

  if (!user) {
    return {
      stats: null,
      deltas: null,
      trends: null,
      snapshotMeta: null
    } satisfies AdminDashboardData;
  }

  if (user.userType === 'developer') {
    redirect(302, '/admin/oauth-clients');
  }

  try {
    const db = mongo.db();

    // Site admins: live totals + snapshot-backed deltas/trends.
    if (user.userType === 'site_admin') {
      maybeCaptureStaleAdminStatsSnapshot(mongo);

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
        totalShopDeleteRequests,
        snapshotView
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
        db.collection('shop_delete_requests').countDocuments(),
        getAdminStatsSnapshotView({ days: 30, periodDays: 7, client: mongo })
      ]);

      const stats = {
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

      const deltas: Record<string, MetricDelta> = { ...snapshotView.period.delta };

      const series = snapshotView.series;
      const trends: Record<string, TrendPoint[]> = {
        totalUsers: toTrend(series, 'users'),
        // University stock is nearly flat (manual catalog imports only); the
        // card charts university changelog activity instead — same visual
        // semantics as before, now backed by real snapshots.
        totalUniversities: toTrend(series, 'universityChangelogs'),
        totalUniversityChangelogs: toTrend(series, 'universityChangelogs'),
        totalClubs: toTrend(series, 'clubs'),
        totalPosts: toTrend(series, 'posts'),
        totalShops: toTrend(series, 'shops'),
        totalShopChangelogs: toTrend(series, 'shopChangelogs'),
        totalMachines: toTrend(series, 'machines'),
        totalImages: toTrend(series, 'images'),
        totalInvites: toTrend(series, 'invites'),
        totalJoinRequests: toTrend(series, 'joinRequests'),
        totalShopDeleteRequests: toTrend(series, 'shopDeleteRequests'),
        totalOAuthClients: toTrend(series, 'oauthClients')
      };

      return {
        stats,
        deltas,
        trends,
        snapshotMeta: {
          capturedAt: snapshotView.latest?.at.toISOString() ?? null,
          prevDate: snapshotView.latest?.prevDate ?? null,
          periodDays: snapshotView.period.days,
          baseline: snapshotView.latest ? snapshotView.latest.added.users == null : true
        }
      } satisfies AdminDashboardData;
    }

    // Non-site admins: scoped live totals only (snapshot capture is site-wide).
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

    const universityFilter =
      managedUniversityIds.length > 0
        ? { id: { $in: managedUniversityIds } }
        : { _nonExistentField: true };

    const universityChangelogFilter =
      managedUniversityIds.length > 0
        ? { type: 'university', targetId: { $in: managedUniversityIds } }
        : { _nonExistentField: true };

    const clubFilter =
      managedClubIds.length > 0 ? { id: { $in: managedClubIds } } : { _nonExistentField: true };

    const permissionFilter = {
      $or: [
        ...(managedClubIds.length > 0 ? [{ type: 'club', targetId: { $in: managedClubIds } }] : []),
        ...(managedUniversityIds.length > 0
          ? [{ type: 'university', targetId: { $in: managedUniversityIds } }]
          : [])
      ]
    };

    const inviteFilter =
      permissionFilter.$or?.length > 0 ? permissionFilter : { _nonExistentField: true };
    const joinRequestFilter =
      permissionFilter.$or?.length > 0 ? permissionFilter : { _nonExistentField: true };

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
      totalJoinRequests
    ] = await Promise.all([
      db.collection('universities').countDocuments(universityFilter),
      db.collection('changelog').countDocuments(universityChangelogFilter),
      db.collection('clubs').countDocuments(clubFilter),
      db.collection('posts').countDocuments(postFilter),
      db.collection('invite_links').countDocuments(inviteFilter),
      db.collection('join_requests').countDocuments(joinRequestFilter)
    ]);

    return {
      stats: {
        totalUniversities,
        totalUniversityChangelogs,
        totalClubs,
        totalPosts,
        totalInvites,
        totalJoinRequests
      },
      deltas: null,
      trends: null,
      snapshotMeta: null
    } satisfies AdminDashboardData;
  } catch (err) {
    console.error('Error loading admin dashboard:', err);
    return {
      stats: null,
      deltas: null,
      trends: null,
      snapshotMeta: null
    } satisfies AdminDashboardData;
  }
};
