import { json, error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { nanoid } from 'nanoid';
import type { z } from 'zod';
import mongo from '$lib/db/index.server';
import { notify } from '$lib/notifications/index.server';
import { commentId, toPlainArray, toPlainObject } from '$lib/utils';
import { getShopDeleteRequestComments } from '$lib/utils/shops/delete-request.server';
import { m } from '$lib/paraglide/messages';
import { attachImagesToOwner } from '$lib/images/index.server';
import {
  shopDeleteRequestCommentCreateRequestSchema,
  shopDeleteRequestCommentCreateResponseSchema,
  shopDeleteRequestCommentSchema,
  shopDeleteRequestCommentsResponseSchema,
  shopDeleteRequestIdParamSchema,
  shopDeleteRequestSchema
} from '$lib/schemas/shops';
import { parseJsonOrError, parseParamsOrError } from '$lib/utils/validation.server';

type ShopDeleteRequestEntry = z.infer<typeof shopDeleteRequestSchema>;
type ShopDeleteRequestCommentEntry = z.infer<typeof shopDeleteRequestCommentSchema>;

export const GET: RequestHandler = async ({ locals, params }) => {
  try {
    const { id } = parseParamsOrError(shopDeleteRequestIdParamSchema, params);
    const db = mongo.db();
    const deleteRequest = await db.collection('shop_delete_requests').findOne({ id });

    if (!deleteRequest) {
      error(404, m.shop_delete_request_not_found());
    }

    const comments = await getShopDeleteRequestComments(
      db,
      deleteRequest.id,
      locals.session?.user?.id
    );
    const response = shopDeleteRequestCommentsResponseSchema.parse(toPlainArray(comments));

    return json(response);
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error fetching delete request comments:', err);
    error(500, m.internal_server_error());
  }
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  try {
    const session = locals.session;
    if (!session?.user?.id) {
      error(401, m.unauthorized());
    }

    const { id } = parseParamsOrError(shopDeleteRequestIdParamSchema, params);
    const {
      content,
      parentCommentId,
      images: imageIds
    } = await parseJsonOrError(request, shopDeleteRequestCommentCreateRequestSchema);

    const db = mongo.db();
    const deleteRequestsCollection = db.collection<ShopDeleteRequestEntry>('shop_delete_requests');
    const commentsCollection = db.collection<ShopDeleteRequestCommentEntry>('comments');

    const deleteRequest = await deleteRequestsCollection.findOne({ id });
    if (!deleteRequest) {
      error(404, m.shop_delete_request_not_found());
    }

    if (deleteRequest.status !== 'pending') {
      error(409, 'This delete request is closed');
    }

    let parentComment: ShopDeleteRequestCommentEntry | null = null;
    if (parentCommentId) {
      parentComment = await commentsCollection.findOne({ id: parentCommentId });
      if (!parentComment || parentComment.shopDeleteRequestId !== deleteRequest.id) {
        error(404, m.parent_comment_not_found());
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

    return json(
      shopDeleteRequestCommentCreateResponseSchema.parse({
        success: true,
        commentId: newComment.id,
        id: nanoid()
      }),
      { status: 201 }
    );
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error creating delete request comment:', err);
    error(500, m.internal_server_error());
  }
};
