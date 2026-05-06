import { json, error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import type { Shop, Comment, CommentWithAuthorAndVote } from '$lib/types';
import { commentId, protect, toPlainArray } from '$lib/utils';
import { notify } from '$lib/notifications/index.server';
import { m } from '$lib/paraglide/messages';

export const GET: RequestHandler = async ({ locals, params }) => {
  try {
    const { id } = params;
    const shopId = parseInt(id);

    const session = locals.session;
    const db = mongo.db();
    const commentsCollection = db.collection<Comment>('comments');

    const comments = await commentsCollection
      .aggregate<CommentWithAuthorAndVote>([
        {
          $match: { shopId: shopId }
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

    return json(toPlainArray(comments));
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

    const { id } = params;
    const shopId = parseInt(id);

    const { content, parentCommentId } = (await request.json()) as {
      content: string;
      parentCommentId?: string;
    };
    if (!content || !content.trim()) {
      error(400, m.comment_content_is_required());
    }

    const db = mongo.db();
    const shopsCollection = db.collection<Shop>('shops');
    const commentsCollection = db.collection<Comment>('comments');

    // Check if shop exists
    const shop = await shopsCollection.findOne({
      id: shopId
    });
    if (!shop) {
      error(404, m.shop_not_found());
    }

    // If replying to a comment, check if parent comment exists and belongs to this shop
    let parentComment: Comment | null = null;
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
    const newComment: Comment = {
      id: commentId(),
      shopId: shopId,
      content: content.trim(),
      createdBy: session.user.id,
      createdAt: new Date(),
      parentCommentId: parentCommentId || null,
      upvotes: 0,
      downvotes: 0
    };

    await commentsCollection.insertOne(newComment);

    try {
      if (parentComment?.createdBy && parentComment.createdBy !== session.user.id) {
        await notify({
          type: 'REPLIES',
          actorUserId: session.user.id,
          actorName: session.user.name || '',
          actorDisplayName: session.user.displayName || undefined,
          actorImage: session.user.image || undefined,
          targetUserId: parentComment.createdBy,
          content: content.trim().substring(0, 200),
          commentId: newComment.id,
          shopId: shop.id,
          shopName: shop.name
        });
      }
    } catch (notificationError) {
      console.error('Failed to send shop reply notification:', notificationError);
    }

    return json(
      {
        success: true,
        commentId: newComment.id
      },
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
