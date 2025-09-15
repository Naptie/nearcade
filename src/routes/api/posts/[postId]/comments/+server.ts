import { json, error } from '@sveltejs/kit';
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

export const POST: RequestHandler = async ({ locals, params, request }) => {
  try {
    const session = await locals.auth();
    if (!session?.user?.id) {
      error(401, 'Unauthorized');
    }

    const postId = params.postId;
    if (!postId) {
      error(400, 'Invalid post ID');
    }

    const { content, parentCommentId } = (await request.json()) as {
      content: string;
      parentCommentId?: string;
    };
    if (!content || !content.trim()) {
      error(400, 'Comment content is required');
    }

    const db = mongo.db();
    const postsCollection = db.collection<Post>('posts');
    const commentsCollection = db.collection<Comment>('comments');

    // Check if post exists
    const post = await postsCollection.findOne({ id: postId });
    if (!post) {
      error(404, 'Post not found');
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
      error(403, 'Permission denied');
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
        error(403, 'Post is locked');
      }
    }

    // If replying to a comment, check if parent comment exists
    if (parentCommentId) {
      const parentComment = await commentsCollection.findOne({ id: parentCommentId });
      if (!parentComment) {
        error(404, 'Parent comment not found');
      }
    }

    // Create new comment
    const newComment: Comment = {
      id: commentId(),
      postId: postId,
      content: content.trim(),
      createdBy: session.user.id,
      createdAt: new Date(),
      parentCommentId: parentCommentId || null,
      upvotes: 0,
      downvotes: 0
    };

    await commentsCollection.insertOne(newComment);

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
            content: content.substring(0, 200), // Truncate long content
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
            content: content.substring(0, 200), // Truncate long content
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
    console.error('Error creating comment:', err);
    error(500, 'Internal server error');
  }
};
