import { error, isHttpError, isRedirect, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import { getActivityHeatmap } from '$lib/utils/activity-heatmap.server';
import { m } from '$lib/paraglide/messages';
import {
  activityHeatmapQuerySchema,
  activityHeatmapResponseSchema,
  userRouteIdParamSchema
} from '$lib/schemas/users';
import { parseParamsOrError, parseQueryOrError } from '$lib/utils/validation.server';

/** Inclusive range cap so a request can never scan unbounded history. */
const HEATMAP_MAX_RANGE_DAYS = 400;

const daysBetween = (from: string, to: string) =>
  Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) /
      (24 * 60 * 60 * 1000)
  );

const toDayString = (date: Date) => date.toISOString().slice(0, 10);

export const GET: RequestHandler = async ({ params, url, locals }) => {
  const session = locals.session;
  const { id } = parseParamsOrError(userRouteIdParamSchema, params);
  const query = parseQueryOrError(activityHeatmapQuerySchema, url);

  try {
    const db = mongo.db();
    const usersCollection = db.collection('users');

    // Get user data
    let user;
    if (id.startsWith('@')) {
      const username = id.slice(1);
      user = await usersCollection.findOne({ name: username });
    } else {
      user = await usersCollection.findOne({ id });
    }

    if (!user) {
      error(404, m.user_not_found());
    }

    // Check if viewing own profile or activities are public
    const isOwnProfile = session?.user?.id === user.id;
    const canViewActivities = isOwnProfile || user.isActivityPublic !== false;

    if (!canViewActivities) {
      error(403, m.activities_are_private());
    }

    // Resolve the effective range: defaults to the last 12 months ending today
    // (UTC day bounds), clamped to the maximum span.
    const timezone = query.timezone ?? 'UTC';
    const today = toDayString(new Date());
    let from = query.from ?? toDayString(new Date(Date.now() - 365 * 24 * 60 * 60 * 1000));
    const to = query.to ?? today;
    if (daysBetween(from, to) > HEATMAP_MAX_RANGE_DAYS) {
      from = toDayString(
        new Date(
          new Date(`${to}T00:00:00Z`).getTime() - HEATMAP_MAX_RANGE_DAYS * 24 * 60 * 60 * 1000
        )
      );
    }
    if (from > to) {
      error(400, '`from` must not be after `to`.');
    }

    const heatmap = await getActivityHeatmap(
      mongo,
      user.id,
      isOwnProfile || session?.user?.userType === 'site_admin',
      { from, to, timezone }
    );

    return json(activityHeatmapResponseSchema.parse(heatmap));
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error loading user activity heatmap:', err);
    error(500, m.failed_to_load_activities());
  }
};
