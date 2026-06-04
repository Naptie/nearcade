import { error, isHttpError, isRedirect, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import { getUserActivities } from '$lib/utils/activity.server';
import { toPlainArray } from '$lib/utils';
import { m } from '$lib/paraglide/messages';
import {
  userActivitiesQuerySchema,
  userActivitiesResponseSchema,
  userRouteIdParamSchema
} from '$lib/schemas/users';
import { parseParamsOrError, parseQueryOrError } from '$lib/utils/validation.server';

export const GET: RequestHandler = async ({ params, url, locals }) => {
  const session = locals.session;
  const { id } = parseParamsOrError(userRouteIdParamSchema, params);
  const { page, limit } = parseQueryOrError(userActivitiesQuerySchema, url);

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

    // Calculate offset
    const offset = (page - 1) * limit;

    // Get activities with pagination
    const activities = await getUserActivities(
      mongo,
      user.id,
      isOwnProfile || session?.user?.userType === 'site_admin',
      limit + 1,
      offset
    );

    // Check if there are more activities
    const hasMore = activities.length > limit;
    if (hasMore) {
      activities.pop(); // Remove the extra item used for hasMore check
    }

    return json(
      userActivitiesResponseSchema.parse({
        activities: toPlainArray(activities),
        hasMore,
        page,
        limit
      })
    );
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error loading user activities:', err);
    error(500, m.failed_to_load_activities());
  }
};
