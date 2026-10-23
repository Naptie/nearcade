/**
 * The post detail: the post itself, its comment thread, and the caller's own
 * vote on it.
 *
 * The post is read with an aggregate rather than a plain lookup because the
 * author travels with it — the client renders both in one go.
 */
import mongo from '$lib/db/index.server';
import { hydrateEntitiesWithImages } from '$lib/images/index.server';
import { m } from '$lib/paraglide/messages';
import { postDetailResponseSchema } from '$lib/schemas/posts';
import type { Comment, CommentWithAuthorAndVote, PostWithAuthor } from '$lib/types';
import type { Post, PostVote } from '$lib/types/index.server';
import { protect } from '$lib/utils';
import { resolvePostAccess } from '$lib/utils/posts/permissions.server';
import { apiError, rethrowApiError } from '../../errors';
import { toPlainWire } from '../../wire.server';
import { assertPostAccess, impl } from './shared';

export const postsDetailImplementation = {
  /** `GET /api/posts/{postId}` */
  detail: impl.detail.handler(async ({ input, context }) => {
    const { postId } = input;

    try {
      const db = mongo.db();
      const postsCollection = db.collection<Post>('posts');
      const commentsCollection = db.collection<Comment>('comments');
      const session = context.session;

      // Get post with author info
      const postResult = await postsCollection
        .aggregate<PostWithAuthor>([
          {
            $match: { id: postId }
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
        apiError('NOT_FOUND', m.post_not_found());
      }

      const [post] = await hydrateEntitiesWithImages(db, [
        { ...postResult[0], author: protect(postResult[0].author) }
      ]);

      // Check if user can read this post based on its readability setting.
      // A locked post is still readable — only the interaction freezes.
      const access = await resolvePostAccess({
        post,
        viewer: session?.user,
        db,
        client: mongo,
        gates: ['read']
      });
      assertPostAccess(access);

      // Get comments for this post
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
      const hydratedComments = await hydrateEntitiesWithImages(db, comments);

      // Get user's vote if logged in
      let userVote = null;
      if (session?.user?.id) {
        const votesCollection = db.collection<PostVote>('post_votes');
        const vote = await votesCollection.findOne({
          postId: postId,
          userId: session.user.id
        });
        userVote = vote ? vote.voteType : null;
      }

      return toPlainWire(postDetailResponseSchema, {
        post,
        comments: hydratedComments,
        userVote
      });
    } catch (err) {
      rethrowApiError(err, m.internal_server_error());
    }
  })
};
