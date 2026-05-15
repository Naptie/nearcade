import { json, error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import {
  type Club,
  type Comment,
  type CommentVote,
  type Post,
  type Shop,
  type ShopDeleteRequest,
  type University
} from '$lib/types';
import { nanoid } from 'nanoid';
import { canReadPost } from '$lib/utils';
import { notify } from '$lib/notifications/index.server';
import { m } from '$lib/paraglide/messages';
import {
  commentIdParamSchema,
  commentVoteRequestSchema,
  commentVoteResponseSchema
} from '$lib/schemas/comments';
import { parseJsonOrError, parseParamsOrError } from '$lib/utils/validation.server';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  try {
    const session = locals.session;
    if (!session?.user?.id) {
      error(401, m.unauthorized());
    }

    const { commentId } = parseParamsOrError(commentIdParamSchema, params);
    const { voteType } = await parseJsonOrError(request, commentVoteRequestSchema);

    const db = mongo.db();
    const commentsCollection = db.collection<Comment>('comments');
    const votesCollection = db.collection<CommentVote>('comment_votes');

    // Check if comment exists
    const comment = await commentsCollection.findOne({ id: commentId });
    if (!comment) {
      error(404, m.comment_not_found());
    }

    // Get the parent entity to check permissions and build notification context.
    let post: Post | null = null;
    let shop: Shop | null = null;
    let deleteRequest: ShopDeleteRequest | null = null;
    if (comment.postId) {
      const postsCollection = db.collection<Post>('posts');
      post = await postsCollection.findOne({ id: comment.postId });
      if (!post) {
        error(404, m.post_not_found());
      }

      const canRead = await canReadPost(
        post.readability,
        { universityId: post.universityId, clubId: post.clubId },
        session?.user,
        mongo
      );

      if (!canRead) {
        error(403, m.permission_denied());
      }

      // Check if post is locked and user has permission to interact
      if (post.isLocked) {
        let canInteract = false;

        if (post.universityId) {
          const university = await db
            .collection<University>('universities')
            .findOne({ id: post.universityId });
          if (university) {
            const { checkUniversityPermission } = await import('$lib/utils');
            const permissions = await checkUniversityPermission(session.user, university, mongo);
            canInteract = permissions.canEdit;
          }
        } else if (post.clubId) {
          const club = await db.collection<Club>('clubs').findOne({ id: post.clubId });
          if (club) {
            const { checkClubPermission } = await import('$lib/utils');
            const permissions = await checkClubPermission(session.user, club, mongo);
            canInteract = permissions.canEdit;
          }
        }

        if (!canInteract) {
          error(403, m.post_is_locked());
        }
      }
    } else if (comment.shopDeleteRequestId) {
      deleteRequest = await db
        .collection<ShopDeleteRequest>('shop_delete_requests')
        .findOne({ id: comment.shopDeleteRequestId });

      if (!deleteRequest) {
        error(404, m.shop_delete_request_not_found());
      }

      if (deleteRequest.status !== 'pending') {
        error(409, 'This delete request is closed');
      }
    } else if (comment.shopId) {
      shop = await db.collection<Shop>('shops').findOne({ id: comment.shopId });
      if (!shop) {
        error(404, m.shop_not_found());
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
      error(500, m.failed_to_get_updated_comment());
    }

    return json(
      commentVoteResponseSchema.parse({
        success: true,
        upvotes: updatedComment.upvotes,
        downvotes: updatedComment.downvotes,
        userVote: newUserVote
      })
    );
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error voting on comment:', err);
    error(500, m.internal_server_error());
  }
};
