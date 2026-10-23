/**
 * Editing and deleting a post.
 *
 * Both endpoints answer the same two questions about the caller: may they
 * change the post's content, and may they manage the post at all? The second
 * one is stricter — pinning and locking a post is reserved for the people who
 * run the organisation the post belongs to.
 */
import mongo from '$lib/db/index.server';
import {
  deleteImagesByIds,
  deleteImagesForOwner,
  replaceOwnerImages
} from '$lib/images/index.server';
import { m } from '$lib/paraglide/messages';
import { postDeleteResponseSchema, postUpdateResponseSchema } from '$lib/schemas/posts';
import type { Comment, CommentVote } from '$lib/types';
import { PostReadability } from '$lib/types';
import type { Post, PostVote } from '$lib/types/index.server';
import { auditUgc, blockedUgcMessage } from '$lib/ugc/audit.server';
import { purgeUgcEntities, submitUgc } from '$lib/ugc/entries.server';
import { getDefaultPostReadability, validatePostReadability } from '$lib/utils';
import {
  resolvePostOrganization,
  resolvePostOrganizationPermissions
} from '$lib/utils/posts/permissions.server';
import { apiError, rethrowApiError, toWire } from '../../errors';
import { assertImagesExist, impl } from './shared';

export const postsMutateImplementation = {
  /** `PUT /api/posts/{postId}` */
  update: impl.update.handler(async ({ input, context }) => {
    const session = context.session;
    if (!session?.user?.id) {
      apiError('UNAUTHORIZED', m.unauthorized());
    }

    const { postId, title, content, readability, isPinned, isLocked, images: imageIds } = input;

    await assertImagesExist(imageIds);

    try {
      const db = mongo.db();
      const postsCollection = db.collection<Post>('posts');

      // Find the post
      const post = await postsCollection.findOne({ id: postId });
      if (!post) {
        apiError('NOT_FOUND', m.post_not_found());
      }

      // Check permissions
      const organization = await resolvePostOrganization(post, db);
      const orgPermissions = await resolvePostOrganizationPermissions(
        organization,
        session.user,
        mongo
      );
      const canEdit = orgPermissions.canEdit;
      const canManage = orgPermissions.canEdit; // Only canEdit users can manage posts
      const orgReadability: PostReadability = organization
        ? getDefaultPostReadability(
            organization.kind === 'university'
              ? organization.university.postReadability
              : organization.club.postReadability
          )
        : PostReadability.PUBLIC;

      // Determine what type of update this is
      const isContentUpdate =
        title !== undefined || content !== undefined || imageIds !== undefined;
      const isManagementUpdate = isPinned !== undefined || isLocked !== undefined;

      // Check permissions for content updates (owner or canEdit)
      if (isContentUpdate || readability !== undefined) {
        const isOwner = post.createdBy === session.user.id;
        if (!isOwner && !canEdit) {
          apiError('FORBIDDEN', m.permission_denied());
        }
      }

      // Validate readability change if specified
      if (readability !== undefined) {
        const permissions = { canEdit, role: canEdit ? 'admin' : '' };

        if (
          !validatePostReadability(readability, orgReadability, permissions, session.user.userType)
        ) {
          apiError('FORBIDDEN', 'Cannot set post readability more open than organization setting');
        }
      }

      // Check permissions for management updates (only canEdit)
      if (isManagementUpdate && !canManage) {
        apiError('FORBIDDEN', m.permission_denied());
      }

      const trimmedTitle = title?.trim();
      const trimmedContent = content?.trim();
      const nextTitle = trimmedTitle ?? post.title;
      const nextContent = trimmedContent ?? post.content;
      const nextImageIds = imageIds ?? post.images ?? [];

      if (isContentUpdate) {
        if (!nextTitle) {
          apiError('BAD_REQUEST', m.title_and_content_are_required());
        }

        if (!nextContent && nextImageIds.length === 0) {
          apiError('BAD_REQUEST', m.title_and_content_are_required());
        }
      }

      // Build update object
      const updateData: Partial<Post> = {};

      if (title !== undefined) {
        updateData.title = nextTitle;
      }
      if (content !== undefined) {
        updateData.content = nextContent;
      }
      if (imageIds !== undefined) {
        try {
          await replaceOwnerImages(
            db,
            post.images ?? [],
            imageIds,
            { postId },
            { userId: session.user.id, userType: session.user.userType }
          );
          updateData.images = imageIds;
        } catch (err) {
          apiError('BAD_REQUEST', err instanceof Error ? String(err.message) : m.error_occurred());
        }
      }
      if (readability !== undefined) {
        updateData.readability = readability;
      }
      if (isPinned !== undefined) {
        updateData.isPinned = isPinned;
      }
      if (isLocked !== undefined) {
        updateData.isLocked = isLocked;
      }

      // Only update updatedAt for content changes, not management changes
      if (isContentUpdate) {
        updateData.updatedAt = new Date();
      }

      // Tier-0 moderation gate: reject content edits before persisting.
      if (isContentUpdate) {
        const blocked = await auditUgc('post', postId, {
          title: nextTitle,
          content: nextContent ?? ''
        });
        if (blocked) {
          apiError('BAD_REQUEST', blockedUgcMessage(blocked));
        }
      }

      // Update the post
      await postsCollection.updateOne({ id: postId }, { $set: updateData });

      // New text → new content hashes; queue background pre-translation.
      if (isContentUpdate) {
        // Register entry + queue background pre-translation for the new text.
        submitUgc('post', postId, session.user, {
          title: nextTitle,
          content: nextContent ?? ''
        });
      }

      return toWire(postUpdateResponseSchema, { success: true });
    } catch (err) {
      rethrowApiError(err, m.internal_server_error());
    }
  }),

  /** `DELETE /api/posts/{postId}` */
  remove: impl.remove.handler(async ({ input, context }) => {
    const session = context.session;
    if (!session?.user?.id) {
      apiError('UNAUTHORIZED', m.unauthorized());
    }

    const { postId } = input;

    try {
      const db = mongo.db();
      const postsCollection = db.collection<Post>('posts');

      // Find the post
      const post = await postsCollection.findOne({ id: postId });
      if (!post) {
        apiError('NOT_FOUND', m.post_not_found());
      }

      // Check permissions (owner or canEdit)
      const isOwner = post.createdBy === session.user.id;
      const organization = await resolvePostOrganization(post, db);
      const orgPermissions = await resolvePostOrganizationPermissions(
        organization,
        session.user,
        mongo
      );
      // The owner may delete their own post, but only while the organisation
      // that owns it still exists — a post whose organisation is gone has
      // nobody left who could authorise the deletion.
      const canDelete = organization !== null && (isOwner || orgPermissions.canEdit);

      if (!canDelete) {
        apiError('FORBIDDEN', m.permission_denied());
      }

      const commentsCollection = db.collection<Comment>('comments');
      const comments = await commentsCollection
        .find({ postId: postId })
        .project({ id: 1, images: 1 })
        .toArray();
      const commentIds = comments.map((comment) => comment.id);
      const commentImageIds = comments.flatMap((comment) => comment.images ?? []);

      if ((post.images?.length ?? 0) > 0) {
        await deleteImagesForOwner(
          db,
          { postId },
          {
            userId: session.user.id,
            userType: session.user.userType,
            skipPermissionCheck: true
          }
        );
      }

      if (commentImageIds.length > 0) {
        await deleteImagesByIds(db, commentImageIds, {
          userId: session.user.id,
          userType: session.user.userType,
          skipPermissionCheck: true
        });
      }

      await commentsCollection.deleteMany({ postId: postId });

      if (commentIds.length > 0) {
        await db
          .collection<CommentVote>('comment_votes')
          .deleteMany({ commentId: { $in: commentIds } });
      }

      // Delete all votes associated with this post
      const votesCollection = db.collection<PostVote>('post_votes');
      await votesCollection.deleteMany({ postId: postId });

      // Delete the post
      await postsCollection.deleteOne({ id: postId });

      await Promise.all([
        purgeUgcEntities('post', [postId]),
        purgeUgcEntities('comment', commentIds)
      ]);

      return toWire(postDeleteResponseSchema, { success: true });
    } catch (err) {
      rethrowApiError(err, m.internal_server_error());
    }
  })
};
