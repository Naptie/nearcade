import type { PageServerLoad } from './$types';
import client from '$lib/db.server';
import type { Club, Post, PostWithAuthor, CommentWithAuthorAndVote, PostVote } from '$lib/types';
import { error } from '@sveltejs/kit';
import { canWriteClubPosts, checkClubPermission, toPlainArray, toPlainObject } from '$lib/utils';

export const load = (async ({ params, locals }) => {
  const { id: clubId, postId } = params;

  const db = client.db();
  const clubsCollection = db.collection<Club>('clubs');
  const postsCollection = db.collection<Post>('posts');
  const commentsCollection = db.collection('comments');

  // Get club
  const club = await clubsCollection.findOne({
    $or: [{ id: clubId }, { slug: clubId }]
  });

  if (!club) {
    throw error(404, 'Club not found');
  }

  // Get post with author
  const postResult = await postsCollection
    .aggregate<PostWithAuthor>([
      {
        $match: {
          id: postId,
          clubId: club.id
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'createdBy',
          foreignField: 'id',
          as: 'authorData'
        }
      },
      {
        $addFields: {
          author: {
            $arrayElemAt: ['$authorData', 0]
          }
        }
      },
      {
        $project: {
          authorData: 0,
          'author._id': 0,
          'author.email': 0
        }
      }
    ])
    .toArray();

  if (postResult.length === 0) {
    throw error(404, 'Post not found');
  }

  const post = postResult[0];
  const session = await locals.auth();

  // Get comments with authors
  const comments = await commentsCollection
    .aggregate<CommentWithAuthorAndVote>([
      {
        $match: { postId: postId }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'createdBy',
          foreignField: 'id',
          as: 'authorData'
        }
      },
      {
        $lookup: {
          from: 'comment_votes',
          localField: 'id',
          foreignField: 'commentId',
          as: 'commentVoteData'
        }
      },
      {
        $addFields: {
          author: {
            $arrayElemAt: ['$authorData', 0]
          },
          vote: {
            $arrayElemAt: [
              {
                $filter: {
                  input: '$commentVoteData',
                  as: 'vote',
                  cond: { $eq: ['$$vote.userId', session?.user?.id] }
                }
              },
              0
            ]
          }
        }
      },
      {
        $project: {
          authorData: 0,
          'author._id': 0,
          'author.email': 0
        }
      },
      {
        $sort: { createdAt: 1 }
      }
    ])
    .toArray();

  let userVote = null;
  let canEdit = false;
  let canManage = false;
  let canComment = false;
  if (session?.user) {
    const votesCollection = db.collection<PostVote>('post_votes');
    const vote = await votesCollection.findOne({
      postId: postId,
      userId: session.user.id
    });
    userVote = vote ? vote.voteType : null;

    const permissions = await checkClubPermission(session.user, club, client);
    canEdit = permissions.canEdit;
    canManage = permissions.canEdit; // Only canEdit users can manage posts
    canComment = canWriteClubPosts(permissions, club);
  }

  return {
    club: toPlainObject(club),
    post: toPlainObject(post),
    comments: toPlainArray(comments),
    userVote,
    canEdit,
    canManage,
    canComment,
    user: session?.user || null
  };
}) satisfies PageServerLoad;
