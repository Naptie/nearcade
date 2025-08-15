import type { MongoClient } from 'mongodb';
import {
  type Post,
  type PostVote,
  type Comment,
  type CommentVote,
  type ChangelogEntry,
  type Activity,
  type Club,
  type University,
  type UniversityMember,
  type ClubMember,
  PostReadability
} from '$lib/types';
import type { User } from '@auth/sveltekit';
import { getDisplayName } from '.';

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
  canViewAll = false,
  limit: number = 20,
  offset: number = 0
): Promise<Activity[]> {
  const db = client.db();
  const activities: Activity[] = [];

  // Get user data to check privacy settings
  const user = await db.collection<User>('users').findOne({ id: userId });
  if (!user) {
    return activities;
  }

  // Check if university-related activities should be included (default: true)
  const includeUniversityActivities = canViewAll || user.isUniversityPublic !== false;

  // Helper function to check if an activity involving a post should be included
  // based on the user's privacy settings and post readability
  const shouldIncludePostActivity = (post: Post | undefined): boolean => {
    if (!post) return false;

    // If user allows university activities to be public, include all posts
    if (includeUniversityActivities) return true;

    // If user has privacy enabled, only include PUBLIC posts
    // This prevents leaking membership information through post interactions
    return post.readability === PostReadability.PUBLIC;
  };

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
    // Only include this post activity if it passes the privacy check
    if (shouldIncludePostActivity(post)) {
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
    }
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

    // Only include this comment activity if the associated post passes the privacy check
    if (shouldIncludePostActivity(post)) {
      activities.push({
        id: comment.id,
        type: isReply ? 'reply' : 'comment',
        createdAt: comment.createdAt,
        userId: comment.createdBy,
        commentContent: comment.content,
        commentId: comment.id,
        parentCommentId: comment.parentCommentId,
        parentPostTitle: post?.title,
        postId: post?.id,
        universityId: post?.universityId,
        clubId: post?.clubId,
        universityName: comment.university?.[0]?.name,
        clubName: comment.club?.[0]?.name,
        // For replies, store the parent comment author in targetAuthorName (reusing this field)
        targetAuthorName: parentCommentAuthor?.name || undefined,
        targetAuthorDisplayName: isReply ? getDisplayName(parentCommentAuthor) : undefined
      });
    }
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

    // Only include this post vote activity if the associated post passes the privacy check
    if (shouldIncludePostActivity(post)) {
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
    }
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

    // Only include this comment vote activity if the associated post passes the privacy check
    if (shouldIncludePostActivity(post)) {
      activities.push({
        id: vote.id,
        type: 'comment_vote',
        createdAt: vote.createdAt,
        userId: vote.userId,
        voteType: vote.voteType,
        targetType: isReplyVote ? 'reply' : 'comment',
        targetTitle: post?.title,
        targetId: vote.commentId,
        targetAuthorName: commentAuthor?.name || undefined,
        targetAuthorDisplayName: getDisplayName(commentAuthor),
        commentId: vote.commentId,
        parentCommentId: comment?.parentCommentId,
        postId: post?.id,
        universityId: post?.universityId,
        clubId: post?.clubId,
        universityName: vote.university?.[0]?.name,
        clubName: vote.club?.[0]?.name
      });
    }
  });

  // Fetch university membership activities (if privacy allows)
  if (includeUniversityActivities) {
    const universityMemberships = (await db
      .collection<UniversityMember>('university_members')
      .aggregate([
        { $match: { userId: userId } },
        {
          $lookup: {
            from: 'universities',
            localField: 'universityId',
            foreignField: 'id',
            as: 'university'
          }
        },
        { $unwind: { path: '$university', preserveNullAndEmptyArrays: false } },
        { $sort: { joinedAt: -1 } },
        { $limit: limit }
      ])
      .toArray()) as (UniversityMember & { university: University })[];

    universityMemberships.forEach((membership) => {
      activities.push({
        id: `university-join-${membership.id}`,
        type: 'university_join',
        createdAt: membership.joinedAt,
        userId: membership.userId,
        joinedUniversityId: membership.universityId,
        joinedUniversityName: membership.university.name,
        universityId: membership.universityId,
        universityName: membership.university.name
      });
    });

    // Fetch club membership activities (if privacy allows)
    const clubMemberships = (await db
      .collection<ClubMember>('club_members')
      .aggregate([
        { $match: { userId: userId } },
        {
          $lookup: {
            from: 'clubs',
            localField: 'clubId',
            foreignField: 'id',
            as: 'club'
          }
        },
        {
          $lookup: {
            from: 'universities',
            localField: 'club.universityId',
            foreignField: 'id',
            as: 'university'
          }
        },
        { $unwind: { path: '$club', preserveNullAndEmptyArrays: false } },
        { $unwind: { path: '$university', preserveNullAndEmptyArrays: false } },
        { $sort: { joinedAt: -1 } },
        { $limit: limit }
      ])
      .toArray()) as (ClubMember & { club: Club; university: University })[];

    clubMemberships.forEach((membership) => {
      activities.push({
        id: `club-join-${membership.id}`,
        type: 'club_join',
        createdAt: membership.joinedAt,
        userId: membership.userId,
        joinedClubId: membership.clubId,
        joinedClubName: membership.club.name,
        clubId: membership.clubId,
        clubName: membership.club.name,
        universityId: membership.club.universityId,
        universityName: membership.university.name
      });
    });

    // Fetch club creation activities (if privacy allows)
    const createdClubs = (await db
      .collection<Club>('clubs')
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
        { $unwind: { path: '$university', preserveNullAndEmptyArrays: false } },
        { $sort: { createdAt: -1 } },
        { $limit: limit }
      ])
      .toArray()) as (Club & { university: University })[];

    createdClubs.forEach((club) => {
      activities.push({
        id: `club-create-${club.id}`,
        type: 'club_create',
        createdAt: club.createdAt || new Date(), // Fallback if createdAt is missing
        userId: club.createdBy || userId,
        createdClubId: club.id,
        createdClubName: club.name,
        clubId: club.id,
        clubName: club.name,
        universityId: club.universityId,
        universityName: club.university.name
      });
    });

    // Fetch changelog entries (if privacy allows)
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
        { $unwind: { path: '$university', preserveNullAndEmptyArrays: true } },
        { $unwind: { path: '$club', preserveNullAndEmptyArrays: true } },
        { $sort: { createdAt: -1 } },
        { $limit: limit }
      ])
      .toArray()) as (ChangelogEntry & { university?: University; club?: Club })[];

    changelogEntries.forEach((entry) => {
      activities.push({
        id: entry.id,
        type: 'changelog',
        createdAt: entry.createdAt,
        userId: entry.userId,
        changelogEntry: entry, // Store full entry for proper formatting
        universityId: entry.type === 'university' ? entry.targetId : undefined,
        universityName: entry.type === 'university' ? entry.university?.name : undefined,
        clubId: entry.type === 'club' ? entry.targetId : undefined,
        clubName: entry.type === 'club' ? entry.club?.name : undefined
      });
    });
  }

  // Sort all activities by creation time (descending) and apply pagination
  activities.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  // Apply offset and limit
  return activities.slice(offset, offset + limit);
}
