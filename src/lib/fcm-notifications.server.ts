/**
 * Server-side Firebase Cloud Messaging utilities
 */
import type { MongoClient } from 'mongodb';
import type { Notification } from '$lib/types';
import {
  generateFCMNotificationContent,
  generateNotificationData
} from './fcm-notifications.client';
import type { User } from '@auth/sveltekit';
import { getMessaging } from 'firebase-admin/messaging';
import app from './firebase.server';

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
  client: MongoClient,
  notification: Notification
): Promise<void> {
  try {
    // Get user's FCM tokens
    const tokens = await getUserFCMTokens(client, notification.targetUserId);
    if (tokens.length === 0) {
      console.log(`No FCM tokens found for user ${notification.targetUserId}`);
      return;
    }

    // Generate notification content
    const { title, body } = generateFCMNotificationContent(notification);
    const data = generateNotificationData(notification);

    // Prepare FCM message
    const message = {
      notification: {
        title,
        body
      },
      data: {
        ...Object.fromEntries(
          Object.entries(data).map(([key, value]) => [key, value?.toString() || ''])
        ),
        notificationId: notification.id,
        type: notification.type
      },
      android: {
        notification: {
          icon: 'ic_notification',
          color: '#1B1717'
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
          icon: '/logo-192.webp',
          badge: '/logo-192.webp',
          tag: `notification-${notification.type}-${notification.id}`
        }
      },
      tokens
    };

    // Send the message
    const response = await getMessaging(app).sendEachForMulticast(message);
    console.log(response, response.responses, response.responses[0].error);

    console.log(
      `FCM notification sent: ${response.successCount} successful, ${response.failureCount} failed`
    );

    // Clean up failed tokens (in a real implementation)
    if (response.failureCount > 0) {
      const failedTokens = response.responses
        .map((resp, idx) => (resp.success ? null : tokens[idx]))
        .filter((token): token is string => token !== null);

      if (failedTokens.length > 0) {
        console.log('Failed FCM tokens to clean up:', failedTokens);
        // TODO: Remove failed tokens from user document
      }
    }
  } catch (error) {
    console.error('Failed to send FCM notification:', error);
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
