import type { MongoClient } from 'mongodb';
import type { Post, PostVote, Comment, CommentVote, ChangelogEntry, Activity } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Fetch recent activities for a user
 */
export async function getUserActivities(
  client: MongoClient,
  userId: string,
  limit: number = 20
): Promise<Activity[]> {
  const db = client.db();
  const activities: Activity[] = [];

  // Fetch posts
  const posts = await db
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
    .toArray();

  posts.forEach((post: any) => {
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
  const comments = await db
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
    .toArray();

  comments.forEach((comment: any) => {
    const post = comment.post?.[0];
    activities.push({
      id: comment.id,
      type: 'comment',
      createdAt: comment.createdAt,
      userId: comment.createdBy,
      commentContent: comment.content.substring(0, 100),
      commentId: comment.id,
      parentPostTitle: post?.title,
      postId: post?.id,
      universityId: post?.universityId,
      clubId: post?.clubId,
      universityName: comment.university?.[0]?.name,
      clubName: comment.club?.[0]?.name
    });
  });

  // Fetch post votes
  const postVotes = await db
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
    .toArray();

  postVotes.forEach((vote: any) => {
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
  const commentVotes = await db
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
    .toArray();

  commentVotes.forEach((vote: any) => {
    const post = vote.post?.[0];
    const commentAuthor = vote.commentAuthor?.[0];
    activities.push({
      id: vote.id,
      type: 'comment_vote',
      createdAt: vote.createdAt,
      userId: vote.userId,
      voteType: vote.voteType,
      targetType: 'comment',
      targetTitle: post?.title,
      targetId: vote.commentId,
      targetAuthorName: commentAuthor?.displayName || commentAuthor?.name,
      commentId: vote.commentId,
      postId: post?.id,
      universityId: post?.universityId,
      clubId: post?.clubId,
      universityName: vote.university?.[0]?.name,
      clubName: vote.club?.[0]?.name
    });
  });

  // Fetch changelog entries
  const changelogEntries = await db
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
    .toArray();

  changelogEntries.forEach((entry: any) => {
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

  // Sort all activities by creation time (descending) and limit
  activities.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return activities.slice(0, limit);
}
