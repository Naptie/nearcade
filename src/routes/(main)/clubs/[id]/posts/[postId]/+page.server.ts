import type { PageServerLoad } from './$types';
import mongo from '$lib/db/index.server';
import {
  type Club,
  type Post,
  type PostWithAuthor,
  type CommentWithAuthorAndVote,
  type PostVote,
  PostReadability
} from '$lib/types';
import { error } from '@sveltejs/kit';
import {
  canWriteClubPosts,
  checkClubPermission,
  protect,
  toPlainArray,
  toPlainObject
} from '$lib/utils';

export const load = (async ({ params, locals }) => {
  const { id: clubId, postId } = params;

  const db = mongo.db();
  const clubsCollection = db.collection<Club>('clubs');
  const postsCollection = db.collection<Post>('posts');
  const commentsCollection = db.collection('comments');

  // Get club
  const club = await clubsCollection.findOne({
    $or: [{ id: clubId }, { slug: clubId }]
  });

  if (!club) {
    error(404, 'Club not found');
  }

  const session = await locals.auth();
  const match: Record<string, unknown> = {
    id: postId,
    clubId: club.id,
    readability: PostReadability.PUBLIC
  };

  let userVote = null;
  let canEdit = false;
  let canManage = false;
  let canComment = false;
  let canJoin = false;
  if (session?.user) {
    const votesCollection = db.collection<PostVote>('post_votes');
    const vote = await votesCollection.findOne({
      postId: postId,
      userId: session.user.id
    });
    userVote = vote ? vote.voteType : null;

    const permissions = await checkClubPermission(session.user, club, mongo, true);
    canEdit = permissions.canEdit;
    canManage = permissions.canEdit; // Only canEdit users can manage posts
    canComment = await canWriteClubPosts(permissions, club, session.user, mongo);
    canJoin = club.acceptJoinRequests && permissions.canJoin > 0;

    if (permissions.role) {
      delete match.readability;
    } else if (permissions.canJoin > 0) {
      match.readability = { $ne: PostReadability.CLUB_MEMBERS };
    }
  }

  // Get post with author
  const postResult = await postsCollection
    .aggregate<PostWithAuthor>([
      {
        $match: match
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
          authorData: 0
        }
      }
    ])
    .toArray();

  if (postResult.length === 0) {
    error(404, 'Post not found');
  }

  const post = { ...postResult[0], author: protect(postResult[0].author) };

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
          authorData: 0
        }
      },
      {
        $sort: { createdAt: 1 }
      }
    ])
    .toArray()
    .then((results) => results.map((r) => ({ ...r, author: protect(r.author) })));

  return {
    club: toPlainObject(club),
    post: toPlainObject(post),
    comments: toPlainArray(comments),
    userVote,
    canEdit,
    canManage,
    canComment,
    canJoin,
    user: session?.user || null
  };
}) satisfies PageServerLoad;
