import { error, isHttpError, isRedirect, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import { markNotificationsAsRead } from '$lib/notifications/index.server';
import type { Notification } from '$lib/types';
import { PAGINATION } from '$lib/constants';
import { m } from '$lib/paraglide/messages';

export const GET: RequestHandler = async ({ url, locals }) => {
  const session = await locals.auth();

  if (!session?.user) {
    error(401, m.unauthorized());
  }

  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = parseInt(url.searchParams.get('limit') || '0') || PAGINATION.PAGE_SIZE;
  const unreadOnly = url.searchParams.get('unreadOnly') === 'true';

  if (page < 1 || limit < 1 || limit > 100) {
    error(400, m.error_invalid_page_or_limit_parameters());
  }

  try {
    // Calculate offset
    const offset = (page - 1) * limit;

    // Build the query filter
    const filter: Record<string, unknown> = { targetUserId: session.user.id };

    // Add unread filter if requested
    if (unreadOnly) {
      filter.readAt = null;
    }

    // Get notifications directly from the notifications collection
    const db = mongo.db();
    const notificationsCollection = db.collection<Notification>('notifications');

    const notifications = await notificationsCollection
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit + 1)
      .toArray();

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
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error loading user notifications:', err);
    error(500, m.error_failed_to_load_notifications());
  }
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const session = await locals.auth();

  if (!session?.user) {
    error(401, m.unauthorized());
  }

  try {
    const { action } = (await request.json()) as { action: string };

    if (action === 'markAsRead') {
      await markNotificationsAsRead(mongo, session.user.id!);
      return json({ success: true });
    }

    error(400, m.error_invalid_action());
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error updating notifications:', err);
    error(500, m.error_failed_to_update_notifications());
  }
};
