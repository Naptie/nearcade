/**
 * The activity endpoints: the paginated activity feed of a user and the
 * per-day heatmap of the same range.
 *
 * Both filter by the same privacy flag and both read the activities with the
 * same permission argument — the viewer sees the private entries of their own
 * profile and of an administrator's.
 */

import { implement } from '@orpc/server';
import mongo from '$lib/db/index.server';
import type { User } from '$lib/auth/types';
import { m } from '$lib/paraglide/messages';
import { activityHeatmapResponseSchema, userActivitiesResponseSchema } from '$lib/schemas/users';

import { getActivityHeatmap } from '$lib/utils/activity-heatmap.server';
import { getUserActivities } from '$lib/utils/activity.server';
import { usersContract } from '../../contracts/users';
import type { ApiContext } from '../../context';
import { apiError, rethrowApiError, toWire } from '../../errors';
import { toPlainArray } from '$lib/utils';
import { toPlainWire } from '../../wire.server';
import { findUserByRouteId } from './shared.server';

/** Inclusive range cap so a request can never scan unbounded history. */
const HEATMAP_MAX_RANGE_DAYS = 400;

const daysBetween = (from: string, to: string) =>
  Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) /
      (24 * 60 * 60 * 1000)
  );

const toDayString = (date: Date) => date.toISOString().slice(0, 10);

const impl = implement(usersContract).$context<ApiContext>();

export const usersActivityImplementation = {
  /** `GET /api/users/{id}/activities` */
  activities: impl.activities.handler(async ({ input, context }) => {
    const session = context.session;
    const { id, page, limit, from, to, types, timezone } = input;

    try {
      const db = mongo.db();
      const usersCollection = db.collection<User>('users');

      // Get user data
      const user = await findUserByRouteId(usersCollection, id);

      // Check if viewing own profile or activities are public
      const isOwnProfile = session?.user?.id === user.id;
      const canViewActivities = isOwnProfile || user.isActivityPublic !== false;

      if (!canViewActivities) {
        apiError('FORBIDDEN', m.activities_are_private());
      }

      // Calculate offset
      const offset = (page - 1) * limit;

      // Get activities with pagination
      const activities = await getUserActivities(
        mongo,
        user.id,
        isOwnProfile || session?.user?.userType === 'site_admin',
        limit + 1,
        offset,
        // Date-range boundaries are interpreted in the viewer's timezone when
        // provided, matching how the heatmap buckets days for the same viewer.
        from && to ? { from, to, timezone: timezone ?? 'UTC', types } : { types }
      );

      // Check if there are more activities
      const hasMore = activities.length > limit;
      if (hasMore) {
        activities.pop(); // Remove the extra item used for hasMore check
      }

      return toPlainWire(userActivitiesResponseSchema, {
        activities: toPlainArray(activities),
        hasMore,
        page,
        limit
      });
    } catch (err) {
      rethrowApiError(err, m.failed_to_load_activities());
    }
  }),

  /** `GET /api/users/{id}/activities/heatmap` */
  activityHeatmap: impl.activityHeatmap.handler(async ({ input, context }) => {
    const session = context.session;
    const { id } = input;

    try {
      const db = mongo.db();
      const usersCollection = db.collection<User>('users');

      // Get user data
      const user = await findUserByRouteId(usersCollection, id);

      // Check if viewing own profile or activities are public
      const isOwnProfile = session?.user?.id === user.id;
      const canViewActivities = isOwnProfile || user.isActivityPublic !== false;

      if (!canViewActivities) {
        apiError('FORBIDDEN', m.activities_are_private());
      }

      // Resolve the effective range: defaults to the last 12 months ending today
      // (UTC day bounds), clamped to the maximum span.
      const timezone = input.timezone ?? 'UTC';
      const today = toDayString(new Date());
      let from = input.from ?? toDayString(new Date(Date.now() - 365 * 24 * 60 * 60 * 1000));
      const to = input.to ?? today;
      if (daysBetween(from, to) > HEATMAP_MAX_RANGE_DAYS) {
        from = toDayString(
          new Date(
            new Date(`${to}T00:00:00Z`).getTime() - HEATMAP_MAX_RANGE_DAYS * 24 * 60 * 60 * 1000
          )
        );
      }
      if (from > to) {
        apiError('BAD_REQUEST', '`from` must not be after `to`.');
      }

      const heatmap = await getActivityHeatmap(
        mongo,
        user.id,
        isOwnProfile || session?.user?.userType === 'site_admin',
        { from, to, timezone }
      );

      if (!heatmap) {
        apiError('INTERNAL_SERVER_ERROR', m.failed_to_load_activities());
      }

      return toWire(activityHeatmapResponseSchema, heatmap);
    } catch (err) {
      rethrowApiError(err, m.failed_to_load_activities());
    }
  })
};
