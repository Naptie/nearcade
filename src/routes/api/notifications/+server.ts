import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import client from '$lib/db.server';
import { getUserNotifications, markNotificationsAsRead } from '$lib/notifications.server';

export const GET: RequestHandler = async ({ url, locals }) => {
  const session = await locals.auth();

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
    // Calculate offset
    const offset = (page - 1) * limit;

    // Get notifications
    const readAfter = unreadOnly ? session.user.notificationReadAt : undefined;
    const notifications = await getUserNotifications(
      client,
      session.user,
      readAfter,
      limit + 1,
      offset
    );

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

export const POST: RequestHandler = async ({ locals, request }) => {
  const session = await locals.auth();

  if (!session?.user) {
    error(401, 'Unauthorized');
  }

  try {
    const { action } = (await request.json()) as { action: string };

    if (action === 'markAsRead') {
      await markNotificationsAsRead(client, session.user.id!);
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
