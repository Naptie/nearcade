import type { PageServerLoad } from './$types';
import mongo from '$lib/db/index.server';
import {
  type University,
  type Post,
  type PostWithAuthor,
  type CommentWithAuthorAndVote,
  type PostVote,
  PostReadability
} from '$lib/types';
import { error } from '@sveltejs/kit';
import {
  canWriteUnivPosts,
  checkUniversityPermission,
  toPlainArray,
  toPlainObject,
  protect
} from '$lib/utils';

export const load = (async ({ params, locals }) => {
  const { id: universityId, postId } = params;

  const db = mongo.db();
  const universitiesCollection = db.collection<University>('universities');
  const postsCollection = db.collection<Post>('posts');
  const commentsCollection = db.collection('comments');

  // Get university
  const university = await universitiesCollection.findOne({
    $or: [{ id: universityId }, { slug: universityId }]
  });

  if (!university) {
    error(404, 'University not found');
  }

  const session = await locals.auth();
  const match: Record<string, unknown> = {
    id: postId,
    universityId: university.id,
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

    const permissions = await checkUniversityPermission(session.user, university, mongo);
    canEdit = permissions.canEdit;
    canManage = permissions.canEdit; // Only canEdit users can manage posts
    canComment = canWriteUnivPosts(permissions, university);
    canJoin = permissions.canJoin > 0;

    if (permissions.role) {
      delete match.readability;
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
    throw error(404, 'Post not found');
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
    university: toPlainObject(university),
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
