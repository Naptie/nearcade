import { error, isHttpError, isRedirect, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import { markNotificationsAsRead } from '$lib/notifications/index.server';
import type { Notification } from '$lib/types';
import { PAGINATION } from '$lib/constants';
import { m } from '$lib/paraglide/messages';
import { notificationsActionSchema } from '$lib/schemas/notifications';
import { validationMessage } from '$lib/schemas/common';

export const GET: RequestHandler = async ({ url, locals }) => {
  const session = locals.session;

  if (!session?.user) {
    error(401, m.unauthorized());
  }

  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = parseInt(url.searchParams.get('limit') || '0') || PAGINATION.PAGE_SIZE;
  const unreadOnly = url.searchParams.get('unreadOnly') === 'true';

  if (page < 1 || limit < 1 || limit > 100) {
    error(400, m.invalid_page_or_limit_parameters());
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
    error(500, m.failed_to_load_notifications());
  }
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const session = locals.session;

  if (!session?.user) {
    error(401, m.unauthorized());
  }

  try {
    const rawBody = await request.json().catch(() => null);
    if (rawBody === null) {
      error(400, 'Invalid request body');
    }

    const parsedBody = notificationsActionSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      error(400, validationMessage(parsedBody.error.issues, m.invalid_action()));
    }

    const { action } = parsedBody.data;

    if (action === 'markAsRead') {
      await markNotificationsAsRead(mongo, session.user.id!);
      return json({ success: true });
    }

    error(400, m.invalid_action());
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error updating notifications:', err);
    error(500, m.failed_to_update_notifications());
  }
};
