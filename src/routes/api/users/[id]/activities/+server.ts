import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import client from '$lib/db/index.server';
import { getUserActivities } from '$lib/utils/activity.server';

export const GET: RequestHandler = async ({ params, url, locals }) => {
  const session = await locals.auth();
  const { id } = params;

  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = parseInt(url.searchParams.get('limit') || '20');

  if (page < 1 || limit < 1 || limit > 100) {
    error(400, 'Invalid page or limit parameters');
  }

  try {
    const db = client.db();
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
      error(404, 'User not found');
    }

    // Check if viewing own profile or activities are public
    const isOwnProfile = session?.user?.id === user.id;
    const canViewActivities = isOwnProfile || user.isActivityPublic !== false;

    if (!canViewActivities) {
      error(403, 'Activities are private');
    }

    // Calculate offset
    const offset = (page - 1) * limit;

    // Get activities with pagination
    const activities = await getUserActivities(
      client,
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
    console.error('Error loading user activities:', err);
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    error(500, 'Failed to load activities');
  }
};
