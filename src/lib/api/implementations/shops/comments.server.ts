/**
 * Shop comments: the hydrated comment thread including the viewer's vote on
 * each entry, and posting a comment or reply with optional images.
 */

import { implement } from '@orpc/server';
import type { z } from 'zod';
import mongo from '$lib/db/index.server';
import { attachImagesToOwner, hydrateEntitiesWithImages } from '$lib/images/index.server';
import { withExistingImages } from '$lib/images/validation.server';
import { notify } from '$lib/notifications/index.server';
import { m } from '$lib/paraglide/messages';
import {
  shopCommentCreateRequestSchema,
  shopCommentEntrySchema,
  shopCommentsResponseSchema
} from '$lib/schemas/shops';
import { auditUgc, blockedUgcMessage } from '$lib/ugc/audit.server';
import { submitUgc } from '$lib/ugc/entries.server';
import type { Shop } from '$lib/types';
import { commentId, protect, toPlainObject } from '$lib/utils';
import { requireBoundPhone } from '$lib/utils/index.server';
import { apiError, parseOrApiErrorAsync, rethrowApiError } from '../../errors';
import { shopsContract } from '../../contracts/shops';
import type { ApiContext } from '../../context';
import { toPlainWire } from './shared.server';

const impl = implement(shopsContract).$context<ApiContext>();

type ShopCommentEntry = z.infer<typeof shopCommentEntrySchema>;

export const shopsCommentsImplementation = {
  /** `GET /api/shops/{id}/comments` */
  comments: impl.comments.handler(async ({ input, context }) => {
    try {
      const shopId = input.id;

      const session = context.session;
      const db = mongo.db();
      const commentsCollection = db.collection<ShopCommentEntry>('comments');

      const comments = await commentsCollection
        .aggregate<ShopCommentEntry>([
          {
            $match: { shopId }
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
                      cond: { $eq: ['$$vote.userId', session?.user?.id ?? ''] }
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
              commentVoteData: 0
            }
          },
          {
            $sort: { createdAt: 1 }
          }
        ])
        .toArray()
        .then((results) => results.map((r) => ({ ...r, author: protect(r.author) })));

      const hydratedComments = await hydrateEntitiesWithImages(db, comments);
      return toPlainWire(shopCommentsResponseSchema, hydratedComments);
    } catch (err) {
      rethrowApiError(err);
    }
  }),

  /** `POST /api/shops/{id}/comments` */
  createComment: impl.createComment.handler(async ({ input, context }) => {
    try {
      // `guard: 'session'` on the contract already rejected an unauthenticated
      // request, so the session is present by construction.
      const session = context.session!;

      requireBoundPhone(session.user);

      const shopId = input.id;
      // The image assets have to exist — the contract only knows their ids.
      const {
        content,
        parentCommentId,
        images: imageIds
      } = await parseOrApiErrorAsync(withExistingImages(shopCommentCreateRequestSchema), input);

      const db = mongo.db();
      const shopsCollection = db.collection<Shop>('shops');
      const commentsCollection = db.collection<ShopCommentEntry>('comments');

      // Check if shop exists
      const shop = await shopsCollection.findOne({
        id: shopId
      });
      if (!shop) {
        apiError('NOT_FOUND', m.shop_not_found());
      }

      // If replying to a comment, check if parent comment exists and belongs to this shop
      let parentComment = null;
      if (parentCommentId) {
        parentComment = await commentsCollection.findOne({ id: parentCommentId });
        if (!parentComment) {
          apiError('NOT_FOUND', m.parent_comment_not_found());
        }
        if (parentComment.shopId !== shopId) {
          apiError('BAD_REQUEST', m.parent_comment_not_found());
        }
      }

      // Create new comment
      const newComment = shopCommentEntrySchema.parse(
        toPlainObject({
          id: commentId(),
          shopId,
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
        if (parentComment?.createdBy && parentComment.createdBy !== session.user.id) {
          await notify({
            type: 'REPLIES',
            actorUserId: session.user.id,
            actorName: session.user.name || '',
            actorDisplayName: session.user.displayName || undefined,
            actorImage: session.user.image || undefined,
            targetUserId: parentComment.createdBy,
            content: content.substring(0, 200),
            commentId: newComment.id,
            shopId: shop.id,
            shopName: shop.name
          });
        }
      } catch (notificationError) {
        console.error('Failed to send shop reply notification:', notificationError);
      }

      return {
        success: true,
        commentId: newComment.id
      };
    } catch (err) {
      rethrowApiError(err);
    }
  })
};
