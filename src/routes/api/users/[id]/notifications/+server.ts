import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import client from '$lib/db.server';
import { getUserNotifications, markNotificationsAsRead } from '$lib/notifications.server';

export const GET: RequestHandler = async ({ params, url, locals }) => {
  const session = await locals.auth();
  const { id } = params;

  if (!session?.user) {
    error(401, 'Unauthorized');
  }

  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = parseInt(url.searchParams.get('limit') || '20');
  const unreadOnly = url.searchParams.get('unreadOnly') === 'true';

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

    // Check if viewing own notifications
    if (session.user._id !== user.id) {
      error(403, "Cannot access other user's notifications");
    }

    // Calculate offset
    const offset = (page - 1) * limit;

    // Get notifications
    const readAfter = unreadOnly ? user.notificationReadAt : undefined;
    const notifications = await getUserNotifications(client, user.id, readAfter, limit + 1, offset);

    // Check if there are more notifications
    const hasMore = notifications.length > limit;
    if (hasMore) {
      notifications.pop(); // Remove the extra item used for hasMore check
    }

    return json({
      notifications,
      hasMore,
      page,
      limit
    });
  } catch (err) {
    console.error('Error loading user notifications:', err);
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    error(500, 'Failed to load notifications');
  }
};

export const POST: RequestHandler = async ({ params, locals, request }) => {
  const session = await locals.auth();
  const { id } = params;

  if (!session?.user) {
    error(401, 'Unauthorized');
  }

  try {
    const { action } = await request.json();

    if (action === 'markAsRead') {
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

      // Check if viewing own notifications
      if (session.user._id !== user.id) {
        error(403, "Cannot access other user's notifications");
      }

      await markNotificationsAsRead(client, user.id);

      return json({ success: true });
    }

    error(400, 'Invalid action');
  } catch (err) {
    console.error('Error updating notifications:', err);
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    error(500, 'Failed to update notifications');
  }
};
