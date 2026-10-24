/**
 * The comment thread on a delete request: reading it, and posting a comment
 * or a reply to it.
 */

import { nanoid } from 'nanoid';
import type { z } from 'zod';
import mongo from '$lib/db/index.server';
import { attachImagesToOwner } from '$lib/images/index.server';
import { withExistingImages } from '$lib/images/validation.server';
import { notify } from '$lib/notifications/index.server';
import { m } from '$lib/paraglide/messages';
import {
  shopDeleteRequestCommentCreateRequestSchema,
  shopDeleteRequestCommentSchema,
  shopDeleteRequestCommentsResponseSchema
} from '$lib/schemas/shops';
import { auditUgc, blockedUgcMessage } from '$lib/ugc/audit.server';
import { submitUgc } from '$lib/ugc/entries.server';
import { commentId, toPlainObject } from '$lib/utils';
import { requireBoundPhone } from '$lib/utils/index.server';
import { getShopDeleteRequestComments } from '$lib/utils/shops/delete-request.server';
import { apiError, parseOrApiErrorAsync, rethrowApiError } from '../../errors';
import { impl } from './delete-requests-shared.server';
import { toPlainWire } from './shared.server';

type ShopDeleteRequestCommentEntry = z.infer<typeof shopDeleteRequestCommentSchema>;

export const shopsDeleteRequestsCommentsImplementation = {
  /** `GET /api/shops/delete-requests/{id}/comments` */
  getDeleteRequestComments: impl.getDeleteRequestComments.handler(async ({ input, context }) => {
    try {
      const { id } = input;
      const db = mongo.db();
      const deleteRequest = await db.collection('shop_delete_requests').findOne({ id });

      if (!deleteRequest) {
        apiError('NOT_FOUND', m.shop_delete_request_not_found());
      }

      const comments = await getShopDeleteRequestComments(
        db,
        deleteRequest.id,
        context.session?.user?.id
      );
      return toPlainWire(shopDeleteRequestCommentsResponseSchema, comments);
    } catch (err) {
      rethrowApiError(err);
    }
  }),

  /** `POST /api/shops/delete-requests/{id}/comments` */
  createDeleteRequestComment: impl.createDeleteRequestComment.handler(
    async ({ input, context }) => {
      try {
        // `guard: 'session'` on the contract already rejected an unauthenticated
        // request, so the session is present by construction.
        const session = context.session!;

        requireBoundPhone(session.user);

        const { id } = input;
        // The image assets have to exist — the contract only knows their ids.
        const {
          content,
          parentCommentId,
          images: imageIds
        } = await parseOrApiErrorAsync(
          withExistingImages(shopDeleteRequestCommentCreateRequestSchema),
          input
        );

        const db = mongo.db();
        const deleteRequestsCollection = db.collection('shop_delete_requests');
        const commentsCollection = db.collection<ShopDeleteRequestCommentEntry>('comments');

        const deleteRequest = await deleteRequestsCollection.findOne({ id });
        if (!deleteRequest) {
          apiError('NOT_FOUND', m.shop_delete_request_not_found());
        }

        if (deleteRequest.status !== 'pending') {
          apiError('CONFLICT', 'This delete request is closed');
        }

        let parentComment = null;
        if (parentCommentId) {
          parentComment = await commentsCollection.findOne({ id: parentCommentId });
          if (!parentComment || parentComment.shopDeleteRequestId !== deleteRequest.id) {
            apiError('NOT_FOUND', m.parent_comment_not_found());
          }
        }

        const newComment = shopDeleteRequestCommentSchema.parse(
          toPlainObject({
            id: commentId(),
            shopDeleteRequestId: deleteRequest.id,
            content,
            images: imageIds,
            createdBy: session.user.id,
            createdAt: new Date(),
            parentCommentId: parentCommentId ?? null,
            upvotes: 0,
            downvotes: 0
          })
        );

        const commentDocument: Omit<typeof newComment, '_id'> = {
          ...newComment
        };

        const blocked = await auditUgc('comment', newComment.id, newComment.content);
        if (blocked) {
          apiError('BAD_REQUEST', blockedUgcMessage(blocked));
        }

        await commentsCollection.insertOne(commentDocument);

        try {
          if (imageIds.length > 0) {
            await attachImagesToOwner(
              db,
              imageIds,
              { commentId: newComment.id },
              { userId: session.user.id, userType: session.user.userType }
            );
          }
        } catch (attachmentError) {
          await commentsCollection.deleteOne({ id: commentDocument.id });
          throw attachmentError;
        }

        // Register entry + queue background pre-translation for the comment.
        submitUgc('comment', newComment.id, session.user, { content: newComment.content });

        try {
          const notificationTargets = new Map<string, 'COMMENTS' | 'REPLIES'>();

          if (parentComment?.createdBy && parentComment.createdBy !== session.user.id) {
            notificationTargets.set(parentComment.createdBy, 'REPLIES');
          }

          if (deleteRequest.requestedBy && deleteRequest.requestedBy !== session.user.id) {
            notificationTargets.set(
              deleteRequest.requestedBy,
              notificationTargets.get(deleteRequest.requestedBy) ?? 'COMMENTS'
            );
          }

          await Promise.all(
            [...notificationTargets.entries()].map(([targetUserId, type]) =>
              notify({
                type,
                actorUserId: session.user.id,
                actorName: session.user.name || '',
                actorDisplayName: session.user.displayName || undefined,
                actorImage: session.user.image || undefined,
                targetUserId,
                content: content.substring(0, 200),
                commentId: newComment.id,
                shopId: deleteRequest.shopId,
                shopDeleteRequestId: deleteRequest.id,
                shopDeleteRequestType: deleteRequest.photoId ? 'photo' : 'shop',
                shopName: deleteRequest.shopName
              })
            )
          );
        } catch (notificationError) {
          console.error('Failed to send delete request comment notification:', notificationError);
        }

        return {
          success: true,
          commentId: newComment.id,
          id: nanoid()
        };
      } catch (err) {
        rethrowApiError(err);
      }
    }
  )
};
