import type { PageServerLoad } from './$types';
import client from '$lib/db.server';
import type {
  University,
  Post,
  PostWithAuthor,
  CommentWithAuthorAndVote,
  PostVote
} from '$lib/types';
import { error } from '@sveltejs/kit';
import { checkUniversityPermission, toPlainArray, toPlainObject } from '$lib/utils';

export const load = (async ({ params, locals }) => {
  const { id: universityId, postId } = params;

  const db = client.db();
  const universitiesCollection = db.collection<University>('universities');
  const postsCollection = db.collection<Post>('posts');
  const commentsCollection = db.collection('comments');

  // Get university
  const university = await universitiesCollection.findOne({
    $or: [{ id: universityId }, { slug: universityId }]
  });

  if (!university) {
    throw error(404, 'University not found');
  }

  // Get post with author
  const postResult = await postsCollection
    .aggregate<PostWithAuthor>([
      {
        $match: {
          id: postId,
          universityId: university.id
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
  if (session?.user) {
    const votesCollection = db.collection<PostVote>('post_votes');
    const vote = await votesCollection.findOne({
      postId: postId,
      userId: session.user.id
    });
    userVote = vote ? vote.voteType : null;

    const permissions = await checkUniversityPermission(session.user, university, client);
    canEdit = permissions.canEdit;
    canManage = permissions.canEdit; // Only canEdit users can manage posts
  }

  return {
    university: toPlainObject(university),
    post: toPlainObject(post),
    comments: toPlainArray(comments),
    userVote,
    canEdit,
    canManage,
    user: session?.user || null
  };
}) satisfies PageServerLoad;
