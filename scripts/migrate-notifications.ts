#!/usr/bin/env tsx
/**
 * Migration script to populate the notifications collection with existing notifications
 * This script uses the existing getUserNotifications function to generate historical notifications
 * for all users and stores them in the new notifications collection format.
 */

import { MongoClient } from 'mongodb';
import { nanoid } from 'nanoid';
import type {
  Club,
  Comment,
  CommentVote,
  JoinRequest,
  Notification,
  NotificationType,
  Post,
  PostVote,
  University,
  UserType
} from '../src/lib/types';
import dotenv from 'dotenv';

if (!('MONGODB_URI' in process.env)) {
  // Load environment variables for local development
  dotenv.config();
}

// Configuration
const MONGODB_URI = process.env.MONGODB_URI;
const BATCH_SIZE = 50; // Process users in batches

interface User {
  id?: string;
  name?: string | null;
  image?: string | null;
  displayName?: string | null;
  userType?: UserType;
  notificationTypes?: NotificationType[];
}

const getUserNotifications = async (
  client: MongoClient,
  user: User | string,
  readAfter?: Date | string,
  limit: number = 20,
  offset: number = 0
): Promise<Notification[]> => {
  const db = client.db();
  const notifications: Notification[] = [];

  if (typeof user === 'string') {
    const dbUser = await db.collection<User>('users').findOne({ id: user });
    if (!dbUser) {
      throw new Error('User not found');
    }
    user = dbUser;
  }

  if (typeof readAfter === 'string') {
    readAfter = new Date(readAfter);
  }

  const notificationTypes = user?.notificationTypes || [
    'COMMENTS',
    'REPLIES',
    'POST_VOTES',
    'COMMENT_VOTES',
    'JOIN_REQUESTS'
  ];

  if (notificationTypes.length === 0) {
    return [];
  }

  // Build match conditions for different notification types
  const matchConditions: Record<string, unknown>[] = [];

  // Get all posts by the user for comment notifications
  if (notificationTypes.includes('COMMENTS')) {
    const userPosts = await db.collection<Post>('posts').find({ createdBy: user.id }).toArray();
    const postIds = userPosts.map((p) => p.id);

    if (postIds.length > 0) {
      matchConditions.push({
        $and: [
          { postId: { $in: postIds } },
          { createdBy: { $ne: user.id } }, // Exclude user's own comments
          { parentCommentId: null } // Only direct comments, not replies
        ]
      });
    }
  }

  // Get all comments by the user for reply notifications
  if (notificationTypes.includes('REPLIES')) {
    const userComments = await db
      .collection<Comment>('comments')
      .find({ createdBy: user.id })
      .toArray();
    const commentIds = userComments.map((c) => c.id);

    if (commentIds.length > 0) {
      matchConditions.push({
        $and: [
          { parentCommentId: { $in: commentIds } },
          { createdBy: { $ne: user.id } } // Exclude user's own replies
        ]
      });
    }
  }

  if (matchConditions.length === 0) {
    return [];
  }

  // Get comments (for COMMENTS and REPLIES notifications)
  const commentNotifications = (await db
    .collection<Comment>('comments')
    .aggregate([
      {
        $match: {
          $or: matchConditions,
          ...(readAfter ? { createdAt: { $gt: readAfter } } : {})
        }
      },
      {
        $lookup: {
          from: 'posts',
          localField: 'postId',
          foreignField: 'id',
          as: 'post'
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'createdBy',
          foreignField: 'id',
          as: 'actor'
        }
      },
      {
        $lookup: {
          from: 'universities',
          localField: 'post.universityId',
          foreignField: 'id',
          as: 'university'
        }
      },
      {
        $lookup: {
          from: 'clubs',
          localField: 'post.clubId',
          foreignField: 'id',
          as: 'club'
        }
      },
      { $sort: { createdAt: -1 } },
      { $limit: limit * 2 } // Get more to account for filtering
    ])
    .toArray()) as (Comment & {
    post?: Post[];
    actor?: User[];
    university?: University[];
    club?: Club[];
  })[];

  commentNotifications.forEach((comment) => {
    const post = comment.post?.[0];
    const actor = comment.actor?.[0];
    const isReply = !!comment.parentCommentId;

    if (actor && post) {
      notifications.push({
        id: `comment-${comment.id}`,
        type: isReply ? 'REPLIES' : 'COMMENTS',
        actorUserId: actor.id || '',
        actorName: actor.name || '',
        actorDisplayName: actor.displayName || undefined,
        actorImage: actor.image || undefined,
        targetUserId: user.id || '',
        createdAt: comment.createdAt,
        postId: post.id,
        postTitle: post.title,
        commentId: comment.id,
        content: comment.content,
        universityId: post.universityId,
        clubId: post.clubId,
        universityName: comment.university?.[0]?.name,
        clubName: comment.club?.[0]?.name
      });
    }
  });

  // Post votes
  if (notificationTypes.includes('POST_VOTES')) {
    const postVotes = (await db
      .collection<PostVote>('post_votes')
      .aggregate([
        {
          $lookup: {
            from: 'posts',
            localField: 'postId',
            foreignField: 'id',
            as: 'post'
          }
        },
        {
          $match: {
            'post.createdBy': user.id,
            userId: { $ne: user.id },
            ...(readAfter ? { createdAt: { $gt: readAfter } } : {})
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: 'userId',
            foreignField: 'id',
            as: 'actor'
          }
        },
        {
          $lookup: {
            from: 'universities',
            localField: 'post.universityId',
            foreignField: 'id',
            as: 'university'
          }
        },
        {
          $lookup: {
            from: 'clubs',
            localField: 'post.clubId',
            foreignField: 'id',
            as: 'club'
          }
        },
        { $sort: { createdAt: -1 } },
        { $limit: limit }
      ])
      .toArray()) as (PostVote & {
      post?: Post[];
      actor?: User[];
      university?: University[];
      club?: Club[];
    })[];

    postVotes.forEach((vote) => {
      const post = vote.post?.[0];
      const actor = vote.actor?.[0];

      if (actor && post) {
        notifications.push({
          id: `post-vote-${vote.id}`,
          type: 'POST_VOTES',
          actorUserId: actor.id || '',
          actorName: actor.name || '',
          actorDisplayName: actor.displayName || undefined,
          actorImage: actor.image || undefined,
          targetUserId: user.id || '',
          createdAt: vote.createdAt,
          postId: post.id,
          postTitle: post.title,
          voteType: vote.voteType,
          universityId: post.universityId,
          clubId: post.clubId,
          universityName: vote.university?.[0]?.name,
          clubName: vote.club?.[0]?.name
        });
      }
    });
  }

  // Comment votes
  if (notificationTypes.includes('COMMENT_VOTES')) {
    const commentVotes = (await db
      .collection<CommentVote>('comment_votes')
      .aggregate([
        {
          $lookup: {
            from: 'comments',
            localField: 'commentId',
            foreignField: 'id',
            as: 'comment'
          }
        },
        {
          $match: {
            'comment.createdBy': user.id,
            userId: { $ne: user.id },
            ...(readAfter ? { createdAt: { $gt: readAfter } } : {})
          }
        },
        {
          $lookup: {
            from: 'posts',
            localField: 'comment.postId',
            foreignField: 'id',
            as: 'post'
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: 'userId',
            foreignField: 'id',
            as: 'actor'
          }
        },
        {
          $lookup: {
            from: 'universities',
            localField: 'post.universityId',
            foreignField: 'id',
            as: 'university'
          }
        },
        {
          $lookup: {
            from: 'clubs',
            localField: 'post.clubId',
            foreignField: 'id',
            as: 'club'
          }
        },
        { $sort: { createdAt: -1 } },
        { $limit: limit }
      ])
      .toArray()) as (CommentVote & {
      comment?: Comment[];
      post?: Post[];
      actor?: User[];
      university?: University[];
      club?: Club[];
    })[];

    commentVotes.forEach((vote) => {
      const comment = vote.comment?.[0];
      const post = vote.post?.[0];
      const actor = vote.actor?.[0];

      if (actor && comment && post) {
        notifications.push({
          id: `comment-vote-${vote.id}`,
          type: 'COMMENT_VOTES',
          actorUserId: actor.id || '',
          actorName: actor.name || '',
          actorDisplayName: actor.displayName || undefined,
          actorImage: actor.image || undefined,
          targetUserId: user.id || '',
          createdAt: vote.createdAt,
          postId: post.id,
          postTitle: post.title,
          commentId: comment.id,
          content: comment.content,
          voteType: vote.voteType,
          universityId: post.universityId,
          clubId: post.clubId,
          universityName: vote.university?.[0]?.name,
          clubName: vote.club?.[0]?.name
        });
      }
    });
  }

  // Join request reviews
  if (notificationTypes.includes('JOIN_REQUESTS')) {
    const joinRequestReviews = (await db
      .collection<JoinRequest>('join_requests')
      .aggregate([
        {
          $match: {
            userId: user.id,
            status: { $in: ['approved', 'rejected'] },
            reviewedAt: { $ne: null },
            ...(readAfter ? { reviewedAt: { $gt: readAfter } } : {})
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: 'reviewedBy',
            foreignField: 'id',
            as: 'reviewer'
          }
        },
        {
          $lookup: {
            from: 'universities',
            localField: 'targetId',
            foreignField: 'id',
            as: 'university'
          }
        },
        {
          $lookup: {
            from: 'clubs',
            localField: 'targetId',
            foreignField: 'id',
            as: 'club'
          }
        },
        { $sort: { reviewedAt: -1 } },
        { $limit: limit }
      ])
      .toArray()) as (JoinRequest & {
      reviewer?: User[];
      university?: University[];
      club?: Club[];
    })[];

    joinRequestReviews.forEach((joinRequest) => {
      const reviewer = joinRequest.reviewer?.[0];
      const university = joinRequest.university?.[0];
      const club = joinRequest.club?.[0];

      if (reviewer && joinRequest.reviewedAt) {
        notifications.push({
          id: `join-request-${joinRequest.id}`,
          type: 'JOIN_REQUESTS',
          actorUserId: reviewer.id || '',
          actorName: reviewer.name || '',
          actorDisplayName: reviewer.displayName || undefined,
          actorImage: reviewer.image || undefined,
          targetUserId: user.id || '',
          createdAt: joinRequest.reviewedAt,
          joinRequestId: joinRequest.id,
          joinRequestStatus: joinRequest.status as 'approved' | 'rejected',
          content: joinRequest.reviewNote || undefined,
          joinRequestType: joinRequest.type,
          universityId: joinRequest.type === 'university' ? joinRequest.targetId : undefined,
          clubId: joinRequest.type === 'club' ? joinRequest.targetId : undefined,
          universityName: joinRequest.type === 'university' ? university?.name : undefined,
          clubName: joinRequest.type === 'club' ? club?.name : undefined
        });
      }
    });
  }

  // Sort all notifications by creation time and apply pagination
  notifications.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return notifications.slice(offset, offset + limit);
};

async function migrateNotifications() {
  console.log('Starting notification migration...');

  const client = new MongoClient(MONGODB_URI!);

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
