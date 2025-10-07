import { error, isHttpError, isRedirect, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import { getUserActivities } from '$lib/utils/activity.server';
import { PAGINATION } from '$lib/constants';
import { m } from '$lib/paraglide/messages';

export const GET: RequestHandler = async ({ params, url, locals }) => {
  const session = await locals.auth();
  const { id } = params;

  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = parseInt(url.searchParams.get('limit') || '0') || PAGINATION.PAGE_SIZE;

  if (page < 1 || limit < 1 || limit > 100) {
    error(400, m.error_invalid_page_or_limit_parameters());
  }

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
      error(403, m.error_activities_are_private());
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

    return json({
      activities,
      hasMore,
      page,
      limit
    });
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error loading user activities:', err);
    error(500, m.error_failed_to_load_activities());
  }
};
