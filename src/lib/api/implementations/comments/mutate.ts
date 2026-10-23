/**
 * Editing and deleting a comment.
 *
 * A comment can hang off a post, off a shop, or off a shop delete request.
 * The post case is the interesting one: there the organisation that owns the
 * post may delete the comment even when it did not write it.
 */
import mongo from '$lib/db/index.server';
import { deleteImagesByIds, replaceOwnerImages } from '$lib/images/index.server';
import { m } from '$lib/paraglide/messages';
import { successResponseSchema } from '$lib/schemas/common';
import type { Comment, CommentVote } from '$lib/types';
import type { Post } from '$lib/types/index.server';
import { auditUgc, blockedUgcMessage } from '$lib/ugc/audit.server';
import { purgeUgcEntities, submitUgc } from '$lib/ugc/entries.server';
import { requireBoundPhone } from '$lib/utils/index.server';
import {
  resolvePostOrganization,
  resolvePostOrganizationPermissions
} from '$lib/utils/posts/permissions.server';
import { apiError, rethrowApiError, toWire } from '../../errors';
import { assertImagesExist, impl } from './shared';

export const commentsMutateImplementation = {
  /** `PUT /api/comments/{commentId}` */
  update: impl.update.handler(async ({ input, context }) => {
    const session = context.session;
    if (!session?.user?.id) {
      apiError('UNAUTHORIZED', m.unauthorized());
    }

    const { commentId, content: trimmedContent, images: imageIds } = input;

    await assertImagesExist(imageIds);

    try {
      const db = mongo.db();
      const commentsCollection = db.collection<Comment>('comments');

      // Check if comment exists and user owns it
      const comment = await commentsCollection.findOne({ id: commentId });
      if (!comment) {
        apiError('NOT_FOUND', m.comment_not_found());
      }

      if (comment.shopId || comment.shopDeleteRequestId) {
        requireBoundPhone(session.user);
      }

      if (comment.createdBy !== session.user.id) {
        apiError('FORBIDDEN', m.you_can_only_edit_your_own_comments());
      }

      try {
        await replaceOwnerImages(
          db,
          comment.images ?? [],
          imageIds,
          { commentId },
          { userId: session.user.id, userType: session.user.userType }
        );
      } catch (err) {
        apiError('BAD_REQUEST', err instanceof Error ? String(err.message) : m.error_occurred());
      }

      // Tier-0 moderation gate: reject the edit before persisting it.
      const blocked = await auditUgc('comment', commentId, trimmedContent ?? '');
      if (blocked) {
        apiError('BAD_REQUEST', blockedUgcMessage(blocked));
      }

      // Update comment
      await commentsCollection.updateOne(
        { id: commentId },
        {
          $set: {
            content: trimmedContent,
            images: imageIds,
            updatedAt: new Date()
          }
        }
      );

      // New text → new content hashes; refresh registry + pre-translation.
      submitUgc('comment', commentId, session.user, { content: trimmedContent });

      return toWire(successResponseSchema, { success: true });
    } catch (err) {
      rethrowApiError(err, m.internal_server_error());
    }
  }),

  /** `DELETE /api/comments/{commentId}` */
  remove: impl.remove.handler(async ({ input, context }) => {
    const session = context.session;
    if (!session?.user?.id) {
      apiError('UNAUTHORIZED', m.unauthorized());
    }

    const { commentId } = input;

    try {
      const db = mongo.db();
      const commentsCollection = db.collection<Comment>('comments');
      const postsCollection = db.collection<Post>('posts');

      // Check if comment exists and user owns it
      const comment = await commentsCollection.findOne({ id: commentId });
      if (!comment) {
        apiError('NOT_FOUND', m.comment_not_found());
      }

      if (comment.shopId || comment.shopDeleteRequestId) {
        requireBoundPhone(session.user);
      }

      // Check permissions (owner or canEdit)
      let canDelete = false;
      const isOwner = comment.createdBy === session.user.id;

      if (comment.shopDeleteRequestId) {
        canDelete = isOwner || session.user.userType === 'site_admin';
      } else if (comment.shopId) {
        // Shop comment: only the owner can delete
        canDelete = isOwner;
      } else {
        const post = await postsCollection.findOne({ id: comment.postId });
        if (!post) {
          apiError('NOT_FOUND', m.post_not_found());
        }

        const organization = await resolvePostOrganization(post, db);
        const orgPermissions = await resolvePostOrganizationPermissions(
          organization,
          session.user,
          mongo
        );
        // The owner may delete their own comment, but only while the
        // organisation that owns the post still exists — a post whose
        // organisation is gone has nobody left who could authorise it.
        canDelete = organization !== null && (isOwner || orgPermissions.canEdit);
      }

      if (!canDelete) {
        apiError('FORBIDDEN', m.permission_denied());
      }

      // Find all comment IDs to be deleted (parent + replies)
      const commentsToDelete = await commentsCollection
        .find({ $or: [{ id: commentId }, { parentCommentId: commentId }] })
        .project({ id: 1, images: 1 })
        .toArray();
      const commentIdsToDelete = commentsToDelete.map((c) => c.id);
      const imageIdsToDelete = commentsToDelete.flatMap(
        (commentToDelete) => commentToDelete.images ?? []
      );

      if (imageIdsToDelete.length > 0) {
        await deleteImagesByIds(db, imageIdsToDelete, {
          userId: session.user.id,
          userType: session.user.userType,
          skipPermissionCheck: true
        });
      }

      // Delete comment and all its replies
      const deleteResult = await commentsCollection.deleteMany({
        $or: [{ id: commentId }, { parentCommentId: commentId }]
      });

      // Delete votes on the comment and its replies
      await db
        .collection<CommentVote>('comment_votes')
        .deleteMany({ commentId: { $in: commentIdsToDelete } });

      // Update post comment count (only for post comments)
      if (comment.postId) {
        await postsCollection.updateOne(
          { id: comment.postId },
          {
            $inc: { commentCount: -deleteResult.deletedCount },
            $set: { updatedAt: new Date() }
          }
        );
      }

      await purgeUgcEntities('comment', commentIdsToDelete);

      return toWire(successResponseSchema, { success: true });
    } catch (err) {
      rethrowApiError(err, m.internal_server_error());
    }
  })
};
