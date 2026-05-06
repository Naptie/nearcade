import { json, error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { nanoid } from 'nanoid';
import mongo from '$lib/db/index.server';
import { notify } from '$lib/notifications/index.server';
import type { Comment, Notification, ShopDeleteRequest } from '$lib/types';
import { commentId, toPlainArray } from '$lib/utils';
import { getShopDeleteRequestComments } from '$lib/utils/shops/delete-request.server';
import { m } from '$lib/paraglide/messages';

export const GET: RequestHandler = async ({ locals, params }) => {
  try {
    const db = mongo.db();
    const deleteRequest = await db
      .collection<ShopDeleteRequest>('shop_delete_requests')
      .findOne({ id: params.id });

    if (!deleteRequest) {
      error(404, m.shop_delete_request_not_found());
    }

    const comments = await getShopDeleteRequestComments(
      db,
      deleteRequest.id,
      locals.session?.user?.id
    );

    return json(toPlainArray(comments));
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

    const { content, parentCommentId } = (await request.json()) as {
      content: string;
      parentCommentId?: string;
    };

    if (!content || !content.trim()) {
      error(400, m.comment_content_is_required());
    }

    const db = mongo.db();
    const deleteRequestsCollection = db.collection<ShopDeleteRequest>('shop_delete_requests');
    const commentsCollection = db.collection<Comment>('comments');

    const deleteRequest = await deleteRequestsCollection.findOne({ id: params.id });
    if (!deleteRequest) {
      error(404, m.shop_delete_request_not_found());
    }

    if (deleteRequest.status !== 'pending') {
      error(409, 'This delete request is closed');
    }

    let parentComment: Comment | null = null;
    if (parentCommentId) {
      parentComment = await commentsCollection.findOne({ id: parentCommentId });
      if (!parentComment || parentComment.shopDeleteRequestId !== deleteRequest.id) {
        error(404, m.parent_comment_not_found());
      }
    }

    const newComment: Comment = {
      id: commentId(),
      shopDeleteRequestId: deleteRequest.id,
      content: content.trim(),
      createdBy: session.user.id,
      createdAt: new Date(),
      parentCommentId: parentCommentId || null,
      upvotes: 0,
      downvotes: 0
    };

    await commentsCollection.insertOne(newComment);

    try {
      const notificationTargets = new Map<string, Notification['type']>();

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
            content: content.trim().substring(0, 200),
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

    return json({ success: true, commentId: newComment.id, id: nanoid() }, { status: 201 });
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error creating delete request comment:', err);
    error(500, m.internal_server_error());
  }
};
