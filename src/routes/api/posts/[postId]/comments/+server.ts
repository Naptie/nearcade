import { json, error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import type { Post, Comment, University, Club } from '$lib/types';
import {
  checkUniversityPermission,
  checkClubPermission,
  canWriteUnivPosts,
  canWriteClubPosts,
  commentId
} from '$lib/utils';
import { notify } from '$lib/notifications/index.server';
import { m } from '$lib/paraglide/messages';
import { attachImagesToOwner, normalizeImageIds } from '$lib/images/index.server';
import { commentCreateRequestSchema } from '$lib/schemas/content';
import { validationMessage } from '$lib/schemas/common';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  try {
    const session = locals.session;
    if (!session?.user?.id) {
      error(401, m.unauthorized());
    }

    const postId = params.postId;
    if (!postId) {
      error(400, m.invalid_post_id());
    }

    const rawBody = await request.json().catch(() => null);
    if (rawBody === null) {
      error(400, 'Invalid request body');
    }

    const parsedBody = commentCreateRequestSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      error(400, validationMessage(parsedBody.error.issues));
    }

    const { content, parentCommentId, images } = parsedBody.data;
    const imageIds = normalizeImageIds(images);
    const trimmedContent = content?.trim() ?? '';

    if (!trimmedContent && imageIds.length === 0) {
      error(400, m.comment_content_is_required());
    }

    const db = mongo.db();
    const postsCollection = db.collection<Post>('posts');
    const commentsCollection = db.collection<Comment>('comments');

    // Check if post exists
    const post = await postsCollection.findOne({ id: postId });
    if (!post) {
      error(404, m.post_not_found());
    }

    // Check commenting permissions based on post writability
    let canComment = false;

    if (post.universityId) {
      const university = await db
        .collection<University>('universities')
        .findOne({ id: post.universityId });
      if (university) {
        const permissions = await checkUniversityPermission(session.user, university, mongo);
        canComment = canWriteUnivPosts(permissions, university);
      }
    } else if (post.clubId) {
      const club = await db.collection<Club>('clubs').findOne({ id: post.clubId });
      if (club) {
        const permissions = await checkClubPermission(session.user, club, mongo);
        canComment = await canWriteClubPosts(permissions, club, session.user, mongo);
      }
    }

    if (!canComment) {
      error(403, m.permission_denied());
    }

    // Check if post is locked and user has permission to comment
    if (post.isLocked) {
      let canInteract = false;

      if (post.universityId) {
        const university = await db
          .collection<University>('universities')
          .findOne({ id: post.universityId });
        if (university) {
          const permissions = await checkUniversityPermission(session.user, university, mongo);
          canInteract = permissions.canEdit;
        }
      } else if (post.clubId) {
        const club = await db.collection<Club>('clubs').findOne({ id: post.clubId });
        if (club) {
          const permissions = await checkClubPermission(session.user, club, mongo);
          canInteract = permissions.canEdit;
        }
      }

      if (!canInteract) {
        error(403, m.post_is_locked());
      }
    }

    // If replying to a comment, check if parent comment exists
    if (parentCommentId) {
      const parentComment = await commentsCollection.findOne({ id: parentCommentId });
      if (!parentComment) {
        error(404, m.parent_comment_not_found());
      }
    }

    // Create new comment
    const newComment: Comment = {
      id: commentId(),
      postId: postId,
      content: trimmedContent,
      images: imageIds,
      createdBy: session.user.id,
      createdAt: new Date(),
      parentCommentId: parentCommentId || null,
      upvotes: 0,
      downvotes: 0
    };

    await commentsCollection.insertOne(newComment);

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
      await commentsCollection.deleteOne({ id: newComment.id });
      throw attachmentError;
    }

    // Update post comment count
    await postsCollection.updateOne(
      { id: postId },
      {
        $inc: { commentCount: 1 }
      }
    );

    // Send notification to relevant users
    try {
      if (parentCommentId) {
        // This is a reply - notify the parent comment author
        const parentComment = await commentsCollection.findOne({ id: parentCommentId });
        if (parentComment && parentComment.createdBy !== session.user.id) {
          await notify({
            type: 'REPLIES',
            actorUserId: session.user.id,
            actorName: session.user.name || '',
            actorDisplayName: session.user.displayName || undefined,
            actorImage: session.user.image || undefined,
            targetUserId: parentComment.createdBy,
            content: trimmedContent.substring(0, 200), // Truncate long content
            postId: post.id,
            postTitle: post.title,
            commentId: newComment.id,
            universityId: post.universityId,
            clubId: post.clubId
          });
        }
      } else {
        // This is a direct comment on a post - notify the post author
        if (post.createdBy !== session.user.id) {
          await notify({
            type: 'COMMENTS',
            actorUserId: session.user.id,
            actorName: session.user.name || '',
            actorDisplayName: session.user.displayName || undefined,
            actorImage: session.user.image || undefined,
            targetUserId: post.createdBy,
            content: trimmedContent.substring(0, 200), // Truncate long content
            postId: post.id,
            postTitle: post.title,
            commentId: newComment.id,
            universityId: post.universityId,
            clubId: post.clubId
          });
        }
      }
    } catch (notificationError) {
      // Don't fail the comment creation if notification fails
      console.error('Failed to send comment notification:', notificationError);
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
    console.error('Error creating comment:', err);
    error(500, m.internal_server_error());
  }
};
