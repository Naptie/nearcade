/**
 * Voting on a comment.
 *
 * A comment can hang off a post, off a shop, or off a shop delete request.
 * Voting on a comment on a post is an interaction with that post, so the
 * caller has to be able to read it and a locked post only accepts votes from
 * the people who manage its organisation.
 */
import { nanoid } from 'nanoid';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { notify } from '$lib/notifications/index.server';
import { commentVoteResponseSchema } from '$lib/schemas/comments';
import type { Comment, CommentVote, Shop } from '$lib/types';
import type { Post, ShopDeleteRequest } from '$lib/types/index.server';
import { requireBoundPhone } from '$lib/utils/index.server';
import { resolvePostAccess } from '$lib/utils/posts/permissions.server';
import { apiError, rethrowApiError, toWire } from '../../errors';
import { assertPostAccess, impl } from './shared.server';

export const commentsVoteImplementation = {
  /** `POST /api/comments/{commentId}/vote` */
  vote: impl.vote.handler(async ({ input, context }) => {
    const session = context.session;
    if (!session?.user?.id) {
      apiError('UNAUTHORIZED', m.unauthorized());
    }

    const { commentId, voteType } = input;

    try {
      const db = mongo.db();
      const commentsCollection = db.collection<Comment>('comments');
      const votesCollection = db.collection<CommentVote>('comment_votes');

      // Check if comment exists
      const comment = await commentsCollection.findOne({ id: commentId });
      if (!comment) {
        apiError('NOT_FOUND', m.comment_not_found());
      }

      if (comment.shopId || comment.shopDeleteRequestId) {
        requireBoundPhone(session.user);
      }

      // Get the parent entity to check permissions and build notification context.
      let post: Post | null = null;
      let shop: Shop | null = null;
      let deleteRequest: ShopDeleteRequest | null = null;
      if (comment.postId) {
        const postsCollection = db.collection<Post>('posts');
        post = await postsCollection.findOne({ id: comment.postId });
        if (!post) {
          apiError('NOT_FOUND', m.post_not_found());
        }

        // Check if user can read the post, and whether a locked post still lets
        // the caller interact with it.
        const access = await resolvePostAccess({
          post,
          viewer: session?.user,
          db,
          client: mongo,
          gates: ['read', 'lock']
        });
        assertPostAccess(access);
      } else if (comment.shopDeleteRequestId) {
        deleteRequest = await db
          .collection<ShopDeleteRequest>('shop_delete_requests')
          .findOne({ id: comment.shopDeleteRequestId });

        if (!deleteRequest) {
          apiError('NOT_FOUND', m.shop_delete_request_not_found());
        }

        if (deleteRequest.status !== 'pending') {
          apiError('CONFLICT', 'This delete request is closed');
        }
      } else if (comment.shopId) {
        shop = await db.collection<Shop>('shops').findOne({ id: comment.shopId });
        if (!shop) {
          apiError('NOT_FOUND', m.shop_not_found());
        }
      }

      // Check for existing vote
      const existingVote = await votesCollection.findOne({
        commentId: commentId,
        userId: session.user.id
      });

      const userId = session.user.id;
      let upvoteDelta = 0;
      let downvoteDelta = 0;
      let newUserVote: 'upvote' | 'downvote' | null = null;

      if (existingVote) {
        if (existingVote.voteType === voteType) {
          // Remove vote (toggle off)
          await votesCollection.deleteOne({
            commentId: commentId,
            userId: userId
          });

          if (voteType === 'upvote') {
            upvoteDelta = -1;
          } else {
            downvoteDelta = -1;
          }
          newUserVote = null;
        } else {
          // Change vote type
          await votesCollection.updateOne(
            {
              commentId: commentId,
              userId: userId
            },
            {
              $set: {
                voteType: voteType,
                createdAt: new Date()
              }
            }
          );

          if (voteType === 'upvote') {
            upvoteDelta = 1;
            downvoteDelta = -1;
          } else {
            upvoteDelta = -1;
            downvoteDelta = 1;
          }
          newUserVote = voteType;
        }
      } else {
        // Create new vote
        const newVote: CommentVote = {
          id: nanoid(),
          commentId: commentId,
          userId: userId,
          voteType: voteType,
          createdAt: new Date()
        };

        await votesCollection.insertOne(newVote);

        if (voteType === 'upvote') {
          upvoteDelta = 1;
        } else {
          downvoteDelta = 1;
        }
        newUserVote = voteType;

        // Send notification for new comment votes
        try {
          if (comment.createdBy !== session.user.id) {
            await notify({
              type: 'COMMENT_VOTES',
              actorUserId: session.user.id,
              actorName: session.user.name || '',
              actorDisplayName: session.user.displayName || undefined,
              actorImage: session.user.image || undefined,
              targetUserId: comment.createdBy,
              content: comment.content.substring(0, 200),
              postId: comment.postId,
              postTitle: post?.title,
              commentId: comment.id,
              voteType: voteType,
              shopId: comment.shopId ?? deleteRequest?.shopId,
              shopDeleteRequestId: comment.shopDeleteRequestId,
              shopDeleteRequestType: deleteRequest?.photoId
                ? 'photo'
                : deleteRequest
                  ? 'shop'
                  : undefined,
              shopName: shop?.name ?? deleteRequest?.shopName,
              universityId: post?.universityId,
              clubId: post?.clubId
            });
          }
        } catch (notificationError) {
          // Don't fail the vote if notification fails
          console.error('Failed to send comment vote notification:', notificationError);
        }
      }

      // Update comment vote counts
      await commentsCollection.updateOne(
        { id: commentId },
        {
          $inc: {
            upvotes: upvoteDelta,
            downvotes: downvoteDelta
          }
        }
      );

      // Get updated vote counts
      const updatedComment = await commentsCollection.findOne({ id: commentId });
      if (!updatedComment) {
        apiError('INTERNAL_SERVER_ERROR', m.failed_to_get_updated_comment());
      }

      return toWire(commentVoteResponseSchema, {
        success: true,
        upvotes: updatedComment.upvotes,
        downvotes: updatedComment.downvotes,
        userVote: newUserVote
      });
    } catch (err) {
      rethrowApiError(err, m.internal_server_error());
    }
  })
};
