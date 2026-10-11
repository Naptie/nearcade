import type { MongoClient } from 'mongodb';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import redis, { ensureConnected } from '$lib/db/redis.server';
import type { User } from '$lib/auth/types';
import { canViewFootprints } from '.';
import { PostReadability } from '$lib/types';
import type { ActivityType } from '$lib/types';

/**
 * User Activity Heatmap Server Module
 *
 * Counts user activities per calendar day, bucketed in a requested IANA
 * timezone, for the profile contribution graph. Privacy gating mirrors
 * `getUserActivities()` in `activity.server.ts` exactly — a day count must
 * never reveal an activity the feed would hide:
 * - `isActivityPublic` is enforced by the calling route (403)
 * - university-gated types (university/club joins, club creation, changelog)
 *   are dropped unless `canViewAll || isUniversityPublic !== false`
 * - when university activities are hidden, post/comment/vote interactions are
 *   counted only for PUBLIC posts (membership-leak prevention)
 * - check-ins and attendance reports are counted only when
 *   `canViewAll || isFootprintPublic`
 *
 * Like the feed, sources requiring an existing target (shop, post, delete
 * request) drop documents whose target vanished, and comments split into three
 * pipelines (post / shop / delete request) because the post-visibility join
 * must not exclude shop comments that have no `postId`.
 */

const HEATMAP_CACHE_TTL_SECONDS = 300;

export interface ActivityHeatmapFilters {
  /** Inclusive start of the range, as `YYYY-MM-DD` in `timezone`. */
  from: string;
  /** Inclusive end of the range, as `YYYY-MM-DD` in `timezone`. */
  to: string;
  /** IANA timezone name used to bucket activities into days. */
  timezone: string;
}

export interface ActivityHeatmapDay {
  date: string;
  total: number;
  byType: Partial<Record<ActivityType, number>>;
}

export interface ActivityHeatmap {
  days: ActivityHeatmapDay[];
  total: number;
  from: string;
  to: string;
  timezone: string;
}

interface HeatmapCachePayload {
  computedAt: number;
  data: ActivityHeatmap;
}

interface DayTypeCountRow {
  _id: { day: string; type: ActivityType };
  count: number;
}

/** `YYYY-MM-DD` shifted one day forward on the calendar (UTC arithmetic). */
const nextDay = (day: string) =>
  new Date(new Date(`${day}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

/**
 * Inclusive day range (`timezone`-local `YYYY-MM-DD`) → UTC timestamp range.
 * Bounds resolve at local midnight in the requested timezone so they line up
 * with the `$dateToString` day bucketing below — for a UTC+8 viewer, the day
 * `2026-01-01` starts at `2025-12-31T16:00Z`, not at UTC midnight.
 */
const dayRangeToUtcRange = (filters: ActivityHeatmapFilters) => ({
  $gte: fromZonedTime(`${filters.from}T00:00:00`, filters.timezone),
  $lt: fromZonedTime(`${nextDay(filters.to)}T00:00:00`, filters.timezone)
});

/**
 * Stages that bucket documents by `day` of `field` in `timezone` and group
 * counts per `{day, type}`. `typeExpr` is a literal type name or an
 * aggregation expression (may yield `null` — those documents are dropped).
 */
const countByDay = (field: string, timezone: string, typeExpr: unknown) => [
  {
    $project: {
      day: { $dateToString: { format: '%Y-%m-%d', date: `$${field}`, timezone } },
      type: typeExpr
    }
  },
  { $match: { type: { $ne: null } } },
  { $group: { _id: { day: '$day', type: '$type' }, count: { $sum: 1 } } }
];

const mergeCounts = (days: Map<string, ActivityHeatmapDay>, rows: DayTypeCountRow[]) => {
  for (const row of rows) {
    if (!row?._id?.day || !row?._id?.type) continue;
    let day = days.get(row._id.day);
    if (!day) {
      day = { date: row._id.day, total: 0, byType: {} };
      days.set(row._id.day, day);
    }
    day.byType[row._id.type] = (day.byType[row._id.type] ?? 0) + row.count;
    day.total += row.count;
  }
};

const runCountPipeline = (
  db: ReturnType<MongoClient['db']>,
  collection: string,
  pipeline: object[]
): Promise<DayTypeCountRow[]> =>
  db.collection(collection).aggregate<DayTypeCountRow>(pipeline).toArray();

/**
 * Count per-day user activities for the contribution heatmap.
 *
 * Day bucketing happens inside Mongo (`$dateToString` with the requested
 * timezone) so the graph stays consistent with the day panel, which filters
 * the activity feed by the same day boundaries.
 */
export async function getActivityHeatmap(
  client: MongoClient,
  userId: string,
  canViewAll: boolean,
  filters: ActivityHeatmapFilters
): Promise<ActivityHeatmap> {
  const db = client.db();

  const user = await db.collection<User>('users').findOne({ id: userId });
  if (!user) {
    return { days: [], total: 0, ...filters };
  }

  const cacheKey = [
    'nearcade:activity-heatmap',
    userId,
    filters.from,
    filters.to,
    filters.timezone,
    canViewAll ? 1 : 0,
    user.isUniversityPublic === false ? 0 : 1,
    user.isFootprintPublic ? 1 : 0
  ].join(':');

  if (redis) {
    try {
      await ensureConnected();
      const cached = await redis.get(cacheKey);
      if (cached) {
        const payload = JSON.parse(cached) as HeatmapCachePayload;
        if (payload?.data?.days) {
          return payload.data;
        }
      }
    } catch {
      // A cache failure must never break the heatmap — fall through to compute.
    }
  }

  const includeUniversityActivities = canViewAll || user.isUniversityPublic !== false;
  const includeFootprints = canViewFootprints(user, canViewAll);
  const range = dayRangeToUtcRange(filters);
  const tz = filters.timezone;
  const days = new Map<string, ActivityHeatmapDay>();

  // Post visibility stages shared by comment/vote pipelines: when the user
  // hides university activity, only PUBLIC-post interactions are countable.
  const postVisibilityStages = includeUniversityActivities
    ? []
    : [{ $match: { 'post.readability': PostReadability.PUBLIC } }];

  // ---- posts (type: post) ----------------------------------------------------
  mergeCounts(
    days,
    await runCountPipeline(db, 'posts', [
      {
        $match: {
          createdBy: userId,
          createdAt: range,
          ...(includeUniversityActivities ? {} : { readability: PostReadability.PUBLIC })
        }
      },
      ...countByDay('createdAt', tz, 'post')
    ])
  );

  // ---- comments attached to posts (type: comment / reply) --------------------
  mergeCounts(
    days,
    await runCountPipeline(db, 'comments', [
      { $match: { createdBy: userId, createdAt: range, postId: { $ne: null } } },
      { $lookup: { from: 'posts', localField: 'postId', foreignField: 'id', as: 'post' } },
      { $unwind: { path: '$post', preserveNullAndEmptyArrays: false } },
      ...postVisibilityStages,
      ...countByDay('createdAt', tz, {
        $cond: [{ $ne: ['$parentCommentId', null] }, 'reply', 'comment']
      })
    ])
  );

  // ---- comments attached to shops (type: shop_comment / shop_reply) ----------
  mergeCounts(
    days,
    await runCountPipeline(db, 'comments', [
      { $match: { createdBy: userId, createdAt: range, shopId: { $ne: null } } },
      { $lookup: { from: 'shops', localField: 'shopId', foreignField: 'id', as: 'shop' } },
      { $unwind: { path: '$shop', preserveNullAndEmptyArrays: false } },
      ...countByDay('createdAt', tz, {
        $cond: [{ $ne: ['$parentCommentId', null] }, 'shop_reply', 'shop_comment']
      })
    ])
  );

  // ---- comments attached to delete requests (types: shop_delete_request_*) ---
  mergeCounts(
    days,
    await runCountPipeline(db, 'comments', [
      {
        $match: { createdBy: userId, createdAt: range, shopDeleteRequestId: { $ne: null } }
      },
      {
        $lookup: {
          from: 'shop_delete_requests',
          localField: 'shopDeleteRequestId',
          foreignField: 'id',
          as: 'deleteRequest'
        }
      },
      { $unwind: { path: '$deleteRequest', preserveNullAndEmptyArrays: false } },
      ...countByDay('createdAt', tz, {
        $cond: [
          { $ne: ['$parentCommentId', null] },
          'shop_delete_request_reply',
          'shop_delete_request_comment'
        ]
      })
    ])
  );

  // ---- votes on post comments (type: comment_vote) ----------------------------
  mergeCounts(
    days,
    await runCountPipeline(db, 'comment_votes', [
      { $match: { userId: userId, createdAt: range } },
      {
        $lookup: {
          from: 'comments',
          localField: 'commentId',
          foreignField: 'id',
          as: 'comment'
        }
      },
      { $unwind: { path: '$comment', preserveNullAndEmptyArrays: false } },
      { $match: { 'comment.postId': { $ne: null } } },
      { $lookup: { from: 'posts', localField: 'comment.postId', foreignField: 'id', as: 'post' } },
      { $unwind: { path: '$post', preserveNullAndEmptyArrays: false } },
      ...postVisibilityStages,
      ...countByDay('createdAt', tz, 'comment_vote')
    ])
  );

  // ---- votes on shop comments (type: shop_comment_vote) ------------------------
  mergeCounts(
    days,
    await runCountPipeline(db, 'comment_votes', [
      { $match: { userId: userId, createdAt: range } },
      {
        $lookup: {
          from: 'comments',
          localField: 'commentId',
          foreignField: 'id',
          as: 'comment'
        }
      },
      { $unwind: { path: '$comment', preserveNullAndEmptyArrays: false } },
      { $match: { 'comment.shopId': { $exists: true, $ne: null } } },
      {
        $lookup: {
          from: 'shops',
          localField: 'comment.shopId',
          foreignField: 'id',
          as: 'shop'
        }
      },
      { $unwind: { path: '$shop', preserveNullAndEmptyArrays: false } },
      ...countByDay('createdAt', tz, 'shop_comment_vote')
    ])
  );

  // ---- votes on delete-request comments (type: shop_delete_request_comment_vote)
  mergeCounts(
    days,
    await runCountPipeline(db, 'comment_votes', [
      { $match: { userId: userId, createdAt: range } },
      {
        $lookup: {
          from: 'comments',
          localField: 'commentId',
          foreignField: 'id',
          as: 'comment'
        }
      },
      { $unwind: { path: '$comment', preserveNullAndEmptyArrays: false } },
      { $match: { 'comment.shopDeleteRequestId': { $exists: true, $ne: null } } },
      {
        $lookup: {
          from: 'shop_delete_requests',
          localField: 'comment.shopDeleteRequestId',
          foreignField: 'id',
          as: 'deleteRequest'
        }
      },
      { $unwind: { path: '$deleteRequest', preserveNullAndEmptyArrays: false } },
      ...countByDay('createdAt', tz, 'shop_delete_request_comment_vote')
    ])
  );

  // ---- delete-request votes (type: shop_delete_request_vote) -------------------
  mergeCounts(
    days,
    await runCountPipeline(db, 'shop_delete_request_votes', [
      { $match: { userId: userId, createdAt: range } },
      {
        $lookup: {
          from: 'shop_delete_requests',
          localField: 'shopDeleteRequestId',
          foreignField: 'id',
          as: 'deleteRequest'
        }
      },
      { $unwind: { path: '$deleteRequest', preserveNullAndEmptyArrays: false } },
      ...countByDay('createdAt', tz, 'shop_delete_request_vote')
    ])
  );

  // ---- university-gated sources -------------------------------------------------
  if (includeUniversityActivities) {
    mergeCounts(
      days,
      await runCountPipeline(db, 'university_members', [
        { $match: { userId: userId, joinedAt: range } },
        ...countByDay('joinedAt', tz, 'university_join')
      ])
    );

    mergeCounts(
      days,
      await runCountPipeline(db, 'club_members', [
        { $match: { userId: userId, joinedAt: range } },
        ...countByDay('joinedAt', tz, 'club_join')
      ])
    );

    mergeCounts(
      days,
      await runCountPipeline(db, 'clubs', [
        { $match: { createdBy: userId, createdAt: range } },
        ...countByDay('createdAt', tz, 'club_create')
      ])
    );

    mergeCounts(
      days,
      await runCountPipeline(db, 'changelog', [
        { $match: { userId: userId, createdAt: range } },
        ...countByDay('createdAt', tz, 'changelog')
      ])
    );
  }

  // ---- shop changelog (never university-gated) -----------------------------------
  mergeCounts(
    days,
    await runCountPipeline(db, 'shop_changelog', [
      { $match: { userId: userId, createdAt: range } },
      ...countByDay('createdAt', tz, 'shop_changelog')
    ])
  );

  // ---- footprint-gated sources -----------------------------------------------------
  // Attendance reports and check-ins both place the user at a shop at a point
  // in time, so neither may be counted when the feed would hide them.
  if (includeFootprints) {
    // ---- attendance reports (type: attendance_report) -----------------------------
    mergeCounts(
      days,
      await runCountPipeline(db, 'attendance_reports', [
        { $match: { reportedBy: userId, reportedAt: range } },
        ...countByDay('reportedAt', tz, 'attendance_report')
      ])
    );

    // ---- check-ins (type: shop_attendance) --------------------------------------------
    mergeCounts(
      days,
      await runCountPipeline(db, 'attendances', [
        { $match: { userId: userId, attendedAt: range } },
        ...countByDay('attendedAt', tz, 'shop_attendance')
      ])
    );

    // A live check-in (Redis session) precedes its Mongo `attendances` row and
    // must still be counted while it is in progress.
    await ensureConnected();
    const keys = await redis.keys(`nearcade:attend:*:${userId}:*`);
    if (keys.length > 0) {
      const dataStr = await redis.get(keys[0]);
      if (dataStr) {
        try {
          const data = JSON.parse(dataStr) as { attendedAt: string };
          const attendedAt = new Date(data.attendedAt);
          if (
            !Number.isNaN(attendedAt.getTime()) &&
            attendedAt >= range.$gte &&
            attendedAt < range.$lt
          ) {
            // Dedupe against the Mongo row written on check-out with the same instant.
            const alreadyRecorded = await db
              .collection('attendances')
              .findOne({ userId, attendedAt });
            if (!alreadyRecorded) {
              mergeCounts(days, [
                {
                  _id: {
                    day: formatInTimeZone(attendedAt, tz, 'yyyy-MM-dd'),
                    type: 'shop_attendance'
                  },
                  count: 1
                }
              ]);
            }
          }
        } catch {
          // Malformed live session — ignore; the Mongo row appears on checkout.
        }
      }
    }
  }

  const resultDays = Array.from(days.values()).sort((a, b) => a.date.localeCompare(b.date));
  const result: ActivityHeatmap = {
    days: resultDays,
    total: resultDays.reduce((sum, day) => sum + day.total, 0),
    ...filters
  };

  if (redis) {
    try {
      await redis.set(cacheKey, JSON.stringify({ computedAt: Date.now(), data: result }), {
        EX: HEATMAP_CACHE_TTL_SECONDS
      });
    } catch {
      // Best-effort cache write.
    }
  }

  return result;
}
