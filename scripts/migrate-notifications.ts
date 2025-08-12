#!/usr/bin/env tsx
/**
 * Migration script to populate the notifications collection with existing notifications
 * This script uses the existing getUserNotifications function to generate historical notifications
 * for all users and stores them in the new notifications collection format.
 */

import { MongoClient } from 'mongodb';
import { nanoid } from 'nanoid';
import type { User } from '@auth/sveltekit';
import type { Notification } from '../src/lib/types';
import dotenv from 'dotenv';

// Import the old getUserNotifications function temporarily for migration
import { getUserNotifications } from '../src/lib/notifications.server';

if (!('MONGODB_URI' in process.env)) {
  // Load environment variables for local development
  dotenv.config();
}

// Configuration
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nearcade';
const BATCH_SIZE = 50; // Process users in batches

async function migrateNotifications() {
  console.log('Starting notification migration...');

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db();

    // Get all users
    const users = await db.collection<User>('users').find({}).toArray();
    console.log(`Found ${users.length} users to migrate notifications for`);

    const notificationsCollection = db.collection<Notification>('notifications');

    // Check if notifications collection exists and has data
    const existingCount = await notificationsCollection.countDocuments({});
    if (existingCount > 0) {
      console.log(
        `Found ${existingCount} existing notifications. Skipping migration to avoid duplicates.`
      );
      console.log(
        'If you want to re-run the migration, please delete the notifications collection first.'
      );
      return;
    }

    let totalMigrated = 0;
    let processedUsers = 0;

    // Process users in batches
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const userBatch = users.slice(i, i + BATCH_SIZE);

      const promises = userBatch.map(async (user) => {
        if (!user.id) {
          console.warn(`User without ID found, skipping: ${user.name || 'unnamed'}`);
          return 0;
        }

        try {
          // Use the old function to get historical notifications
          // Get a larger number to capture all historical notifications
          const historicalNotifications = await getUserNotifications(
            client,
            user,
            undefined, // No date filter - get all notifications
            1000, // Large limit to get all notifications
            0 // No offset
          );

          if (historicalNotifications.length === 0) {
            return 0;
          }

          // Convert to new notification format and insert
          const newNotifications: Notification[] = historicalNotifications.map((notification) => ({
            ...notification,
            // Ensure we have all required fields with proper defaults
            id: notification.id || nanoid(),
            readAt: null, // Mark all migrated notifications as unread initially
            createdAt: notification.createdAt || new Date()
          }));

          // Insert notifications in smaller batches to avoid memory issues
          const insertBatchSize = 100;
          for (let j = 0; j < newNotifications.length; j += insertBatchSize) {
            const insertBatch = newNotifications.slice(j, j + insertBatchSize);
            await notificationsCollection.insertMany(insertBatch, { ordered: false });
          }

          return newNotifications.length;
        } catch (error) {
          console.error(`Error migrating notifications for user ${user.name || user.id}:`, error);
          return 0;
        }
      });

      const results = await Promise.all(promises);
      const batchMigrated = results.reduce((sum, count) => sum + count, 0);
      totalMigrated += batchMigrated;
      processedUsers += userBatch.length;

      console.log(
        `Processed ${processedUsers}/${users.length} users. Migrated ${batchMigrated} notifications in this batch.`
      );
    }

    console.log(`\nMigration completed successfully!`);
    console.log(`Total users processed: ${processedUsers}`);
    console.log(`Total notifications migrated: ${totalMigrated}`);

    // Verify the migration
    const finalCount = await notificationsCollection.countDocuments({});
    console.log(`Final notifications collection count: ${finalCount}`);
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await client.close();
  }
}

// Run the migration
migrateNotifications()
  .then(() => {
    console.log('Migration script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration script failed:', error);
    process.exit(1);
  });
