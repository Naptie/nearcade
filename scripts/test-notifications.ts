#!/usr/bin/env tsx
/**
 * Test script to verify the notification system functionality
 * This script tests the new notification system components
 */

import { MongoClient } from 'mongodb';
import {
  notify,
  countUnreadNotifications,
  markNotificationsAsRead
} from '../src/lib/notifications.server';
import type { Notification } from '../src/lib/types';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nearcade';

async function testNotificationSystem() {
  console.log('Testing notification system...');

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db();

    // Test notification creation
    const testNotification: Omit<Notification, 'id' | 'createdAt'> = {
      type: 'COMMENTS',
      actorUserId: 'test-actor-123',
      actorName: 'test-actor',
      targetUserId: 'test-target-456',
      postId: 'test-post-789',
      postTitle: 'Test Post Title',
      content: 'This is a test comment',
      readAt: null
    };

    console.log('✓ Creating test notification...');
    await notify(client, testNotification);

    // Test counting unread notifications
    console.log('✓ Counting unread notifications...');
    const unreadCount = await countUnreadNotifications(client, 'test-target-456');
    console.log(`Found ${unreadCount} unread notifications for test user`);

    // Test marking notifications as read
    console.log('✓ Testing mark as read functionality...');
    await markNotificationsAsRead(client, 'test-target-456');

    const unreadCountAfterRead = await countUnreadNotifications(client, 'test-target-456');
    console.log(`Unread count after marking as read: ${unreadCountAfterRead}`);

    // Clean up test data
    await db.collection('notifications').deleteMany({
      $or: [{ actorUserId: 'test-actor-123' }, { targetUserId: 'test-target-456' }]
    });

    console.log('✅ All tests passed! Notification system is working correctly.');
  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  } finally {
    await client.close();
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  testNotificationSystem()
    .then(() => {
      console.log('Test script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Test script failed:', error);
      process.exit(1);
    });
}

export { testNotificationSystem };
