import { json, error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { z } from 'zod';
import mongo from '$lib/db/index.server';
import { commentId, protect, toPlainArray, toPlainObject } from '$lib/utils';
import { notify } from '$lib/notifications/index.server';
import { m } from '$lib/paraglide/messages';
import { attachImagesToOwner, hydrateEntitiesWithImages } from '$lib/images/index.server';
import {
  shopCommentCreateRequestSchema,
  shopCommentCreateResponseSchema,
  shopCommentEntrySchema,
  shopCommentsResponseSchema,
  shopIdParamSchema
} from '$lib/schemas/shops';
import { parseJsonOrError, parseParamsOrError } from '$lib/utils/validation.server';

type ShopCommentEntry = z.infer<typeof shopCommentEntrySchema>;

export const GET: RequestHandler = async ({ locals, params }) => {
  try {
    const { id: shopId } = parseParamsOrError(shopIdParamSchema, params);

    const session = locals.session;
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
    const response = shopCommentsResponseSchema.parse(toPlainArray(hydratedComments));

    return json(response);
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error fetching shop comments:', err);
    error(500, m.internal_server_error());
  }
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  try {
    const session = locals.session;
    if (!session?.user?.id) {
      error(401, m.unauthorized());
    }

    const { id: shopId } = parseParamsOrError(shopIdParamSchema, params);
    const {
      content,
      parentCommentId,
      images: imageIds
    } = await parseJsonOrError(request, shopCommentCreateRequestSchema);

    const db = mongo.db();
    const shopsCollection = db.collection('shops');
    const commentsCollection = db.collection<ShopCommentEntry>('comments');

    // Check if shop exists
    const shop = await shopsCollection.findOne({
      id: shopId
    });
    if (!shop) {
      error(404, m.shop_not_found());
    }

    // If replying to a comment, check if parent comment exists and belongs to this shop
    let parentComment: ShopCommentEntry | null = null;
    if (parentCommentId) {
      parentComment = await commentsCollection.findOne({ id: parentCommentId });
      if (!parentComment) {
        error(404, m.parent_comment_not_found());
      }
      if (parentComment.shopId !== shopId) {
        error(400, m.parent_comment_not_found());
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

    return json(
      shopCommentCreateResponseSchema.parse({
        success: true,
        commentId: newComment.id
      }),
      { status: 201 }
    );
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error creating shop comment:', err);
    error(500, m.internal_server_error());
  }
};
