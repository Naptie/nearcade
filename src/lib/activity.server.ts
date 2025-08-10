import type { MongoClient } from 'mongodb';
import type {
  Post,
  PostVote,
  Comment,
  CommentVote,
  ChangelogEntry,
  Activity,
  Club,
  University
} from './types';
import type { User } from '@auth/sveltekit';

/**
 * User Activity Server Module
 *
 * This module provides functionality to fetch and aggregate user activities from various
 * collections in the MongoDB database. It combines posts, comments, votes, and changelog
 * entries into a unified activity feed for display on user profiles.
 *
 * Supported activity types:
 * - Posts created by the user
 * - Comments made by the user
 * - Post votes (upvotes/downvotes) by the user
 * - Comment votes by the user
 * - Changelog entries created by the user when editing university/club information
 *
 * All activities are sorted by creation time in descending order and include
 * navigation links to the relevant content with proper highlighting support.
 */

/**
 * Fetch recent activities for a user
 */
export async function getUserActivities(
  client: MongoClient,
  userId: string,
  limit: number = 20,
  offset: number = 0
): Promise<Activity[]> {
  const db = client.db();
  const activities: Activity[] = [];

  // Fetch posts
  const posts = (await db
    .collection<Post>('posts')
    .aggregate([
      { $match: { createdBy: userId } },
      {
        $lookup: {
          from: 'universities',
          localField: 'universityId',
          foreignField: 'id',
          as: 'university'
        }
      },
      {
        $lookup: {
          from: 'clubs',
          localField: 'clubId',
          foreignField: 'id',
          as: 'club'
        }
      },
      { $sort: { createdAt: -1 } },
      { $limit: limit }
    ])
    .toArray()) as (Post & { university?: University[]; club?: Club[] })[];

  posts.forEach((post) => {
    activities.push({
      id: post.id,
      type: 'post',
      createdAt: post.createdAt,
      userId: post.createdBy,
      postTitle: post.title,
      postId: post.id,
      universityId: post.universityId,
      clubId: post.clubId,
      universityName: post.university?.[0]?.name,
      clubName: post.club?.[0]?.name
    });
  });

  // Fetch comments
  const comments = (await db
    .collection<Comment>('comments')
    .aggregate([
      { $match: { createdBy: userId } },
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
          from: 'comments',
          localField: 'parentCommentId',
          foreignField: 'id',
          as: 'parentComment'
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'parentComment.createdBy',
          foreignField: 'id',
          as: 'parentCommentAuthor'
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
    .toArray()) as (Comment & {
    post?: Post[];
    parentComment?: Comment[];
    parentCommentAuthor?: User[];
    university?: University[];
    club?: Club[];
  })[];

  comments.forEach((comment) => {
    const post = comment.post?.[0];
    const parentCommentAuthor = comment.parentCommentAuthor?.[0];
    const isReply = !!comment.parentCommentId;
    activities.push({
      id: comment.id,
      type: isReply ? 'reply' : 'comment',
      createdAt: comment.createdAt,
      userId: comment.createdBy,
      commentContent: comment.content.substring(0, 100),
      commentId: comment.id,
      parentCommentId: comment.parentCommentId,
      parentPostTitle: post?.title,
      postId: post?.id,
      universityId: post?.universityId,
      clubId: post?.clubId,
      universityName: comment.university?.[0]?.name,
      clubName: comment.club?.[0]?.name,
      // For replies, store the parent comment author in targetAuthorName (reusing this field)
      targetAuthorName: isReply
        ? parentCommentAuthor?.displayName || parentCommentAuthor?.name
        : undefined
    });
  });

  // Fetch post votes
  const postVotes = (await db
    .collection<PostVote>('post_votes')
    .aggregate([
      { $match: { userId: userId } },
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
    .toArray()) as (PostVote & { post?: Post[]; university?: University[]; club?: Club[] })[];

  postVotes.forEach((vote) => {
    const post = vote.post?.[0];
    activities.push({
      id: vote.id,
      type: 'post_vote',
      createdAt: vote.createdAt,
      userId: vote.userId,
      voteType: vote.voteType,
      targetType: 'post',
      targetTitle: post?.title,
      targetId: vote.postId,
      postId: vote.postId,
      universityId: post?.universityId,
      clubId: post?.clubId,
      universityName: vote.university?.[0]?.name,
      clubName: vote.club?.[0]?.name
    });
  });

  // Fetch comment votes
  const commentVotes = (await db
    .collection<CommentVote>('comment_votes')
    .aggregate([
      { $match: { userId: userId } },
      {
        $lookup: {
          from: 'comments',
          localField: 'commentId',
          foreignField: 'id',
          as: 'comment'
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
          localField: 'comment.createdBy',
          foreignField: 'id',
          as: 'commentAuthor'
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
    commentAuthor?: User[];
    university?: University[];
    club?: Club[];
  })[];

  commentVotes.forEach((vote) => {
    const comment = vote.comment?.[0];
    const post = vote.post?.[0];
    const commentAuthor = vote.commentAuthor?.[0];
    const isReplyVote = !!comment?.parentCommentId;

    activities.push({
      id: vote.id,
      type: 'comment_vote',
      createdAt: vote.createdAt,
      userId: vote.userId,
      voteType: vote.voteType,
      targetType: isReplyVote ? 'reply' : 'comment',
      targetTitle: post?.title,
      targetId: vote.commentId,
      targetAuthorName: commentAuthor?.displayName || commentAuthor?.name || undefined,
      commentId: vote.commentId,
      parentCommentId: comment?.parentCommentId,
      postId: post?.id,
      universityId: post?.universityId,
      clubId: post?.clubId,
      universityName: vote.university?.[0]?.name,
      clubName: vote.club?.[0]?.name
    });
  });

  // Fetch changelog entries
  const changelogEntries = (await db
    .collection<ChangelogEntry>('changelog')
    .aggregate([
      { $match: { userId: userId } },
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
      { $sort: { createdAt: -1 } },
      { $limit: limit }
    ])
    .toArray()) as (ChangelogEntry & { university?: University[]; club?: Club[] })[];

  changelogEntries.forEach((entry) => {
    const university = entry.university?.[0];
    const club = entry.club?.[0];

    activities.push({
      id: entry.id,
      type: 'changelog',
      createdAt: entry.createdAt,
      userId: entry.userId,
      changelogAction: entry.action,
      changelogDescription: `${entry.fieldInfo.field} - ${entry.action}`,
      changelogTargetName: entry.type === 'university' ? university?.name : club?.name,
      changelogTargetId: entry.targetId,
      changelogEntry: entry, // Store full entry for proper formatting
      universityId: entry.type === 'university' ? entry.targetId : undefined,
      clubId: entry.type === 'club' ? entry.targetId : undefined
    });
  });

  // Sort all activities by creation time (descending) and apply pagination
  activities.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  // Apply offset and limit
  return activities.slice(offset, offset + limit);
}
