import { json, error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import type { Club, Comment, CommentVote, Post, University } from '$lib/types';
import { checkUniversityPermission, checkClubPermission } from '$lib/utils';
import { m } from '$lib/paraglide/messages';

export const PUT: RequestHandler = async ({ locals, params, request }) => {
  try {
    const session = await locals.auth();
    if (!session?.user?.id) {
      error(401, m.unauthorized());
    }

    const commentId = params.commentId;
    if (!commentId) {
      error(400, m.invalid_comment_id());
    }

    const { content } = (await request.json()) as {
      content: string;
    };
    if (!content || !content.trim()) {
      error(400, m.comment_content_is_required());
    }

    const db = mongo.db();
    const commentsCollection = db.collection<Comment>('comments');

    // Check if comment exists and user owns it
    const comment = await commentsCollection.findOne({ id: commentId });
    if (!comment) {
      error(404, m.comment_not_found());
    }

    if (comment.createdBy !== session.user.id) {
      error(403, m.you_can_only_edit_your_own_comments());
    }

    // Update comment
    await commentsCollection.updateOne(
      { id: commentId },
      {
        $set: {
          content: content.trim(),
          updatedAt: new Date()
        }
      }
    );

    return json({ success: true });
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error updating comment:', err);
    error(500, m.internal_server_error());
  }
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  try {
    const session = await locals.auth();
    if (!session?.user?.id) {
      error(401, m.unauthorized());
    }

    const commentId = params.commentId;
    if (!commentId) {
      error(400, m.invalid_comment_id());
    }

    const db = mongo.db();
    const commentsCollection = db.collection<Comment>('comments');
    const postsCollection = db.collection<Post>('posts');

    // Check if comment exists and user owns it
    const comment = await commentsCollection.findOne({ id: commentId });
    if (!comment) {
      error(404, m.comment_not_found());
    }

    // Check permissions (owner or canEdit)
    let canDelete = false;
    const isOwner = comment.createdBy === session.user.id;

    if (comment.shopSource) {
      // Shop comment: only the owner can delete
      canDelete = isOwner;
    } else {
      const post = await postsCollection.findOne({ id: comment.postId });
      if (!post) {
        error(404, m.post_not_found());
      }

      if (post.universityId) {
        const university = await db
          .collection<University>('universities')
          .findOne({ id: post.universityId });
        if (university) {
          const permissions = await checkUniversityPermission(session.user, university, mongo);
          canDelete = isOwner || permissions.canEdit;
        }
      } else if (post.clubId) {
        const club = await db.collection<Club>('clubs').findOne({ id: post.clubId });
        if (club) {
          const permissions = await checkClubPermission(session.user, club, mongo);
          canDelete = isOwner || permissions.canEdit;
        }
      }
    }

    if (!canDelete) {
      error(403, m.permission_denied());
    }

    // Find all comment IDs to be deleted (parent + replies)
    const commentsToDelete = await commentsCollection
      .find({ $or: [{ id: commentId }, { parentCommentId: commentId }] })
      .project({ id: 1 })
      .toArray();
    const commentIdsToDelete = commentsToDelete.map((c) => c.id);

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

    return json({ success: true });
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error deleting comment:', err);
    error(500, m.internal_server_error());
  }
};
