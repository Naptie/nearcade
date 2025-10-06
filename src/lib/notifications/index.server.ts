import type { MongoClient } from 'mongodb';
import type { ClubMember, UniversityMember, Notification } from '$lib/types';
import type { User } from '@auth/sveltekit';
import { nanoid } from 'nanoid';
import { sendFCMNotification } from './fcm.server';
import { SSC_SECRET } from '$env/static/private';
import { env } from '$env/dynamic/private';
import mongo from '$lib/db/index.server';

/**
 * Sends an active notification to a user
 * This function handles both storing the notification in the database
 * and sending PWA notifications to the user
 */
export const notify = async (
  notification: Omit<Notification, 'id' | 'createdAt'>
): Promise<void> => {
  const db = mongo.db();
  const notificationsCollection = db.collection<Notification>('notifications');

  // Check if user wants this type of notification
  const targetUser = await db.collection<User>('users').findOne({ id: notification.targetUserId });
  if (!targetUser) {
    console.warn(`Notification target user not found: ${notification.targetUserId}`);
    return;
  }

  const userNotificationTypes = targetUser.notificationTypes || [
    'COMMENTS',
    'REPLIES',
    'POST_VOTES',
    'COMMENT_VOTES',
    'JOIN_REQUESTS'
  ];

  if (!userNotificationTypes.includes(notification.type)) {
    // User has disabled this type of notification
    return;
  }

  // Don't notify users about their own actions
  if (notification.actorUserId === notification.targetUserId) {
    return;
  }

  // Create the notification with generated ID and timestamp
  const fullNotification: Notification = {
    ...notification,
    id: nanoid(),
    createdAt: new Date(),
    readAt: null
  };

  try {
    // Store in database
    await notificationsCollection.insertOne(fullNotification);

    // Send FCM notification
    await notifyFCM(fullNotification);
  } catch (error) {
    console.error('Failed to send notification:', error);
  }
};

const notifyFCM = async (notification: Notification) => {
  if (!env.FCM_PROXY) {
    await sendFCMNotification(notification);
  } else {
    const response = await fetch(env.FCM_PROXY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: SSC_SECRET
      },
      body: JSON.stringify(notification)
    });
    console.log('FCM response:', response.status, await response.text());
  }
};

/**
 * Count unread notifications for a user
 */
export const countUnreadNotifications = async (
  client: MongoClient,
  userId: string
): Promise<number> => {
  const db = client.db();
  const notificationsCollection = db.collection<Notification>('notifications');

  return await notificationsCollection.countDocuments({
    targetUserId: userId,
    readAt: null
  });
};

/**
 * Mark notifications as read for a user
 */
export const markNotificationsAsRead = async (
  client: MongoClient,
  userId: string,
  notificationIds?: string[]
): Promise<void> => {
  const db = client.db();
  const notificationsCollection = db.collection<Notification>('notifications');

  const filter: Record<string, unknown> = {
    targetUserId: userId,
    readAt: null // Only mark unread notifications
  };

  // If specific notification IDs provided, only mark those
  if (notificationIds && notificationIds.length > 0) {
    filter.id = { $in: notificationIds };
  }

  await notificationsCollection.updateMany(filter, { $set: { readAt: new Date() } });
};

/**
 * Count pending join requests that a user should manage
 */
export const countPendingJoinRequests = async (
  client: MongoClient,
  user: User | string
): Promise<number | undefined> => {
  const db = client.db();

  if (typeof user === 'string') {
    const dbUser = await db.collection<User>('users').findOne({ id: user });
    if (!dbUser) {
      return 0;
    }
    user = dbUser;
  }
  if (
    !['site_admin', 'school_admin', 'school_moderator', 'club_admin', 'club_moderator'].includes(
      user.userType || ''
    )
  ) {
    return undefined;
  }

  // Get user's club/university memberships where they have admin/moderator role
  const [clubMemberships, universityMemberships] = await Promise.all([
    db
      .collection<ClubMember>('club_members')
      .find({
        userId: user.id,
        memberType: { $in: ['admin', 'moderator'] }
      })
      .toArray(),
    db
      .collection<UniversityMember>('university_members')
      .find({
        userId: user.id,
        memberType: { $in: ['admin', 'moderator'] }
      })
      .toArray()
  ]);

  const managedClubIds = clubMemberships.map((m) => m.clubId);
  const managedUniversityIds = universityMemberships.map((m) => m.universityId);

  // Build permission filter for join requests
  const permissionFilter = {
    $or: [
      ...(managedClubIds.length > 0 ? [{ type: 'club', targetId: { $in: managedClubIds } }] : []),
      ...(managedUniversityIds.length > 0
        ? [{ type: 'university', targetId: { $in: managedUniversityIds } }]
        : [])
    ]
  };

  if (permissionFilter.$or?.length === 0) {
    return 0; // User has no admin privileges
  }

  return await db.collection('join_requests').countDocuments({
    status: 'pending',
    ...permissionFilter
  });
};
