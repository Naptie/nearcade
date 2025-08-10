import type { MongoClient } from 'mongodb';
import type { Post, Comment, PostVote, CommentVote, University, Club } from './types';
import type { User } from '@auth/sveltekit';

export interface Notification {
  _id?: string;
  id: string;
  type: 'COMMENTS' | 'REPLIES' | 'POST_VOTES' | 'COMMENT_VOTES';
  actorUserId: string;
  actorName: string;
  actorDisplayName?: string;
  actorImage?: string;
  targetUserId: string;
  createdAt: Date;

  // Content details
  postId?: string;
  postTitle?: string;
  commentId?: string;
  commentContent?: string;
  voteType?: 'upvote' | 'downvote';

  // Navigation
  universityId?: string;
  clubId?: string;
  universityName?: string;
  clubName?: string;
}

/**
 * Get notifications for a user using MongoDB aggregation
 */
export async function getUserNotifications(
  client: MongoClient,
  user: User | string,
  readAfter?: Date | string,
  limit: number = 20,
  offset: number = 0
): Promise<Notification[]> {
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
    'COMMENT_VOTES'
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
        commentContent: comment.content.substring(0, 100),
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
          commentContent: comment.content.substring(0, 100),
          voteType: vote.voteType,
          universityId: post.universityId,
          clubId: post.clubId,
          universityName: vote.university?.[0]?.name,
          clubName: vote.club?.[0]?.name
        });
      }
    });
  }

  // Sort all notifications by creation time and apply pagination
  notifications.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return notifications.slice(offset, offset + limit);
}

/**
 * Count notifications for a user using MongoDB aggregation
 */
export async function countUserNotifications(
  client: MongoClient,
  user: User | string,
  readAfter?: Date | string
): Promise<number> {
  const db = client.db();

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
    'COMMENT_VOTES'
  ];

  if (notificationTypes.length === 0) {
    return 0;
  }

  let count = 0;

  // COMMENTS
  if (notificationTypes.includes('COMMENTS')) {
    const userPosts = await db.collection<Post>('posts').find({ createdBy: user.id }).toArray();
    const postIds = userPosts.map((p) => p.id);

    if (postIds.length > 0) {
      count += await db.collection<Comment>('comments').countDocuments({
        postId: { $in: postIds },
        createdBy: { $ne: user.id },
        parentCommentId: null,
        ...(readAfter ? { createdAt: { $gt: readAfter } } : {})
      });
    }
  }

  // REPLIES
  if (notificationTypes.includes('REPLIES')) {
    const userComments = await db
      .collection<Comment>('comments')
      .find({ createdBy: user.id })
      .toArray();
    const commentIds = userComments.map((c) => c.id);

    if (commentIds.length > 0) {
      count += await db.collection<Comment>('comments').countDocuments({
        parentCommentId: { $in: commentIds },
        createdBy: { $ne: user.id },
        ...(readAfter ? { createdAt: { $gt: readAfter } } : {})
      });
    }
  }

  // POST_VOTES
  if (notificationTypes.includes('POST_VOTES')) {
    const postVotesCount = await db
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
        { $count: 'total' }
      ])
      .toArray();
    count += postVotesCount[0]?.total || 0;
  }

  // COMMENT_VOTES
  if (notificationTypes.includes('COMMENT_VOTES')) {
    const commentVotesCount = await db
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
        { $count: 'total' }
      ])
      .toArray();
    count += commentVotesCount[0]?.total || 0;
  }

  return count;
}

/**
 * Mark notifications as read for a user
 */
export async function markNotificationsAsRead(client: MongoClient, userId: string): Promise<void> {
  const db = client.db();
  await db
    .collection('users')
    .updateOne({ id: userId }, { $set: { notificationReadAt: new Date() } });
}

/**
 * Count pending join requests that a user can manage
 */
export async function countPendingJoinRequests(
  client: MongoClient,
  user: User | string
): Promise<number> {
  const db = client.db();

  if (typeof user === 'string') {
    const dbUser = await db.collection<User>('users').findOne({ id: user });
    if (!dbUser) {
      return 0;
    }
    user = dbUser;
  }

  // Site admins can manage all join requests
  if (user.userType === 'site_admin') {
    return await db.collection('join_requests').countDocuments({ status: 'pending' });
  }

  // For non-site admins, apply scope-based filtering
  // Get user's club/university memberships where they have admin/moderator role
  const [clubMemberships, universityMemberships] = await Promise.all([
    db
      .collection('club_members')
      .find({
        userId: user.id,
        memberType: { $in: ['admin', 'moderator'] }
      })
      .toArray(),
    db
      .collection('university_members')
      .find({
        userId: user.id,
        memberType: { $in: ['admin', 'moderator'] }
      })
      .toArray()
  ]);

  const managedClubIds = clubMemberships.map((m: any) => m.clubId);
  const managedUniversityIds = universityMemberships.map((m: any) => m.universityId);

  // Build permission filter for join requests
  const permissionFilter = {
    $or: [
      ...(managedClubIds.length > 0 ? [{ type: 'club', targetId: { $in: managedClubIds } }] : []),
      ...(managedUniversityIds.length > 0 ? [{ type: 'university', targetId: { $in: managedUniversityIds } }] : [])
    ]
  };

  if (permissionFilter.$or?.length === 0) {
    return 0; // User has no admin privileges
  }

  return await db.collection('join_requests').countDocuments({
    status: 'pending',
    ...permissionFilter
  });
}
