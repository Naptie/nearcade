import { implement } from '@orpc/server';
import {
  fcmSendResponseSchema,
  fcmTokenResponseSchema,
  notificationListResponseSchema,
  notificationsContract
} from '../contracts/notifications';
import type { ApiContext } from '../context';
import { apiError, rethrowApiError, toWire } from '../errors';
import mongo from '$lib/db/index.server';
import type { Notification } from '$lib/types';
import { markNotificationsAsRead } from '$lib/notifications/index.server';
import { sendFCMNotification, storeFCMToken, removeFCMToken } from '$lib/notifications/fcm.server';
import { successResponseSchema } from '$lib/schemas/common';
import { m } from '$lib/paraglide/messages';

const impl = implement(notificationsContract).$context<ApiContext>();

export const notificationsImplementation = {
  list: impl.list.handler(async ({ input, context }) => {
    const session = context.session;

    if (!session?.user) {
      apiError('UNAUTHORIZED', m.unauthorized());
    }

    const { page, limit, unreadOnly } = input;

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

      // The notification object is loose — unknown fields are passed through —
      // so the storage identifier is dropped here rather than by the schema.
      const published = notifications.map((notification) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { _id, ...rest } = notification;
        return rest;
      });

      return toWire(notificationListResponseSchema, {
        notifications: published,
        hasMore,
        page,
        limit
      });
    } catch (err) {
      rethrowApiError(err, m.failed_to_load_notifications());
    }
  }),

  markRead: impl.markRead.handler(async ({ input, context }) => {
    const session = context.session;

    if (!session?.user) {
      apiError('UNAUTHORIZED', m.unauthorized());
    }

    try {
      const { action } = input;

      if (action === 'markAsRead') {
        await markNotificationsAsRead(mongo, session.user.id!);
        return toWire(successResponseSchema, { success: true });
      }

      apiError('BAD_REQUEST', m.invalid_action());
    } catch (err) {
      rethrowApiError(err, m.failed_to_update_notifications());
    }
  }),

  sendFcm: impl.sendFcm.handler(async ({ input }) => {
    // `guard: 'secret'` on the contract means `enforceAuthGuard` already
    // compared the raw `Authorization` header against `SSC_SECRET`; a second
    // copy of that comparison here could only drift from it.
    const { success, response } = await sendFCMNotification(input as unknown as Notification);

    if (!success) {
      apiError('INTERNAL_SERVER_ERROR', 'Failed to send the FCM notification');
    }

    if (!response || !(response.successCount > 0)) {
      apiError('BAD_REQUEST', 'The notification was not delivered to any device');
    }

    return toWire(fcmSendResponseSchema, response);
  }),

  fcmToken: impl.fcmToken.handler(async ({ input, context }) => {
    const session = context.session;

    if (!session?.user?.id) {
      apiError('UNAUTHORIZED', m.unauthorized());
    }

    try {
      const { token, action } = input;

      if (!token || !action) {
        apiError('BAD_REQUEST', m.missing_token_or_action());
      }

      if (action === 'store') {
        await storeFCMToken(mongo, session.user.id, token);
        return toWire(fcmTokenResponseSchema, { success: true, message: 'FCM token stored' });
      } else if (action === 'remove') {
        await removeFCMToken(mongo, session.user.id, token);
        return toWire(fcmTokenResponseSchema, { success: true, message: 'FCM token removed' });
      } else {
        apiError('BAD_REQUEST', m.invalid_action());
      }
    } catch (err) {
      rethrowApiError(err, m.failed_to_manage_fcm_token());
    }
  })
};
