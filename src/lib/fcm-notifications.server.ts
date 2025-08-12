/**
 * Server-side Firebase Cloud Messaging utilities
 */
import type { MongoClient } from 'mongodb';
import type { Notification } from '$lib/types';
import { generateFCMNotificationContent, generateNotificationData } from './fcm-notifications.client';

// Firebase Admin SDK initialization
let admin: typeof import('firebase-admin') | null = null;
let messaging: import('firebase-admin/messaging').Messaging | null = null;

/**
 * Initialize Firebase Admin SDK
 */
async function initializeFirebaseAdmin() {
  if (admin && messaging) {
    return messaging;
  }

  try {
    admin = await import('firebase-admin');
    
    // Check if Firebase app is already initialized
    if (admin.apps.length === 0) {
      // In production, you would use service account credentials
      // For now, we'll use the default credentials if available
      admin.initializeApp({
        // credential: admin.credential.cert(serviceAccount),
        // In a real deployment, you would set this up with proper credentials
      });
    }

    messaging = admin.messaging();
    return messaging;
  } catch (error) {
    console.warn('Firebase Admin SDK not properly configured:', error);
    return null;
  }
}

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
  return Array.isArray(user.fcmTokens) ? user.fcmTokens.filter((token: unknown): token is string => typeof token === 'string' && token.length > 0) : [];
}

/**
 * Send FCM notification to user
 */
export async function sendFCMNotification(
  client: MongoClient,
  notification: Notification
): Promise<void> {
  try {
    const messaging = await initializeFirebaseAdmin();
    if (!messaging) {
      console.warn('Firebase Admin SDK not available, skipping FCM notification');
      return;
    }

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
          'TTL': '86400'
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
    const response = await messaging.sendEachForMulticast(message);
    
    console.log(`FCM notification sent: ${response.successCount} successful, ${response.failureCount} failed`);
    
    // Clean up failed tokens (in a real implementation)
    if (response.failureCount > 0) {
      const failedTokens = response.responses
        .map((resp, idx) => resp.success ? null : tokens[idx])
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
  const usersCollection = db.collection('users');

  await usersCollection.updateOne(
    { id: userId },
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $addToSet: { fcmTokens: token } as any,
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
  const usersCollection = db.collection('users');

  await usersCollection.updateOne(
    { id: userId },
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $pull: { fcmTokens: token } as any,
      $set: { fcmTokenUpdatedAt: new Date() }
    }
  );
}