/**
 * Server-side Firebase Cloud Messaging utilities
 */
import type { MongoClient } from 'mongodb';
import type { Notification } from '$lib/types';
import type { User } from '$lib/auth/types';
import { getMessaging, type BatchResponse } from 'firebase-admin/messaging';
import app from './firebase.server';
import mongo from '$lib/db/index.server';
import { getNotificationTitle } from './index.client';

/**
 * Get user's FCM tokens from database
 */
async function getUserFCMTokens(client: MongoClient, userId: string): Promise<string[]> {
  const db = client.db();
  const usersCollection = db.collection('users');

  const user = await usersCollection.findOne({ id: userId });
  if (!user?.fcmTokens) {
    return [];
  }

  // Filter out any invalid/expired tokens (in a real implementation, you'd clean these up)
  return Array.isArray(user.fcmTokens)
    ? user.fcmTokens.filter(
        (token: unknown): token is string => typeof token === 'string' && token.length > 0
      )
    : [];
}

/**
 * Send FCM notification to user
 */
export async function sendFCMNotification(
  notification: Notification
): Promise<{ success: boolean; response: BatchResponse | undefined }> {
  if (!app) {
    console.log('[FCM Server] Firebase app not initialized, skipping');
    return { success: false, response: undefined };
  }
  try {
    // Get user's FCM tokens
    const tokens = await getUserFCMTokens(mongo, notification.targetUserId);
    if (tokens.length === 0) {
      console.log(`[FCM Server] No FCM tokens found for user ${notification.targetUserId}`);
      return { success: true, response: undefined };
    }
    console.log(
      `[FCM Server] Found ${tokens.length} FCM token(s) for user ${notification.targetUserId}`
    );

    // Prepare FCM message
    const title = getNotificationTitle(notification);
    const body = notification.content || '';
    console.log(`[FCM Server] Sending notification: "${title}" - "${body}"`);

    const message = {
      notification: {
        title,
        body
      },
      data: {
        notification: JSON.stringify(notification)
      },
      android: {
        notification: {
          icon: 'ic_notification',
          color: '#1B1618'
        }
      },
      apns: {
        payload: {
          aps: {
            badge: 1
          }
        }
      },
      webpush: {
        headers: {
          TTL: '86400'
        },
        notification: {
          icon: notification.actorImage,
          badge: notification.actorImage,
          tag: `notification-${notification.type}-${notification.id}`
        }
      },
      tokens
    };

    // Send the message
    console.log('[FCM Server] Calling sendEachForMulticast with', tokens.length, 'token(s)');
    const messaging = getMessaging(app);
    messaging.enableLegacyHttpTransport();
    const response = await messaging.sendEachForMulticast(message);

    console.log(
      `[FCM Server] sendEachForMulticast result: ${response.successCount} successful, ${response.failureCount} failed`
    );

    // Log individual response errors
    if (response.failureCount > 0) {
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          console.error(`[FCM Server] Token ${idx} failed:`, resp.error?.code, resp.error?.message);
        }
      });
    }

    // Clean up failed tokens
    if (response.failureCount > 0) {
      const failedTokens = response.responses
        .map((resp, idx) => (resp.success ? null : tokens[idx]))
        .filter((token): token is string => token !== null);

      if (failedTokens.length > 0) {
        console.log('Failed FCM tokens to clean up:', failedTokens);
        failedTokens.forEach(async (token) => {
          await removeFCMToken(mongo, notification.targetUserId, token);
        });
      }
    }

    return { success: true, response };
  } catch (error) {
    console.error('Failed to send FCM notification:', error);
    return { success: false, response: undefined };
  }
}

/**
 * Store FCM token for a user
 */
export async function storeFCMToken(
  client: MongoClient,
  userId: string,
  token: string
): Promise<void> {
  const db = client.db();
  const usersCollection = db.collection<User>('users');

  await usersCollection.updateOne(
    { id: userId },
    {
      $addToSet: { fcmTokens: token },
      $set: { fcmTokenUpdatedAt: new Date() }
    }
  );
}

/**
 * Remove FCM token for a user
 */
export async function removeFCMToken(
  client: MongoClient,
  userId: string,
  token: string
): Promise<void> {
  const db = client.db();
  const usersCollection = db.collection<User>('users');

  await usersCollection.updateOne(
    { id: userId },
    {
      $pull: { fcmTokens: token },
      $set: { fcmTokenUpdatedAt: new Date() }
    }
  );
}
