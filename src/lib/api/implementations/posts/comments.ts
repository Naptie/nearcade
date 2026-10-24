/**
 * Commenting on a post.
 *
 * Writing a comment needs two separate permissions: the organisation the post
 * belongs to has to let the caller post in the first place, and a locked post
 * only opens up for the people who manage that organisation.
 */
import mongo from '$lib/db/index.server';
import { attachImagesToOwner } from '$lib/images/index.server';
import { m } from '$lib/paraglide/messages';
import { notify } from '$lib/notifications/index.server';
import { postCommentCreateResponseSchema } from '$lib/schemas/posts';
import type { Comment } from '$lib/types';
import type { Post } from '$lib/types/index.server';
import { auditUgc, blockedUgcMessage } from '$lib/ugc/audit.server';
import { submitUgc } from '$lib/ugc/entries.server';
import { commentId } from '$lib/utils';
import { resolvePostAccess } from '$lib/utils/posts/permissions.server';
import { apiError, rethrowApiError, toWire } from '../../errors';
import { assertImagesExist, assertPostAccess, impl } from './shared';

export const postsCommentsImplementation = {
  /** `POST /api/posts/{postId}/comments` */
  comment: impl.comment.handler(async ({ input, context }) => {
    const session = context.session;
    if (!session?.user?.id) {
      apiError('UNAUTHORIZED', m.unauthorized());
    }

    const { postId, content: trimmedContent, parentCommentId, images: imageIds } = input;

    await assertImagesExist(imageIds);

    try {
      const db = mongo.db();
      const postsCollection = db.collection<Post>('posts');
      const commentsCollection = db.collection<Comment>('comments');

      // Check if post exists
      const post = await postsCollection.findOne({ id: postId });
      if (!post) {
        apiError('NOT_FOUND', m.post_not_found());
      }

      // Check commenting permissions based on post writability, and whether a
      // locked post still lets the caller in.
      const access = await resolvePostAccess({
        post,
        viewer: session.user,
        db,
        client: mongo,
        gates: ['write', 'lock']
      });
      assertPostAccess(access);

      // If replying to a comment, check if parent comment exists
      if (parentCommentId) {
        const parentComment = await commentsCollection.findOne({ id: parentCommentId });
        if (!parentComment) {
          apiError('NOT_FOUND', m.parent_comment_not_found());
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

      const blocked = await auditUgc('comment', newComment.id, newComment.content);
      if (blocked) {
        apiError('BAD_REQUEST', blockedUgcMessage(blocked));
      }

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

      // Register entry + queue background pre-translation for the comment.
      submitUgc('comment', newComment.id, session.user, { content: newComment.content });

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

      return toWire(postCommentCreateResponseSchema, {
        success: true,
        commentId: newComment.id
      });
    } catch (err) {
      rethrowApiError(err, m.internal_server_error());
    }
  })
};
