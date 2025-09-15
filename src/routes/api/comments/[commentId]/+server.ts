import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import type { Club, Comment, CommentVote, Post, University } from '$lib/types';
import { checkUniversityPermission, checkClubPermission } from '$lib/utils';

export const PUT: RequestHandler = async ({ locals, params, request }) => {
  try {
    const session = await locals.auth();
    if (!session?.user?.id) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }

    const commentId = params.commentId;
    if (!commentId) {
      return json({ error: 'Invalid comment ID' }, { status: 400 });
    }

    const { content } = (await request.json()) as {
      content: string;
    };
    if (!content || !content.trim()) {
      return json({ error: 'Comment content is required' }, { status: 400 });
    }

    const db = mongo.db();
    const commentsCollection = db.collection<Comment>('comments');

    // Check if comment exists and user owns it
    const comment = await commentsCollection.findOne({ id: commentId });
    if (!comment) {
      return json({ error: 'Comment not found' }, { status: 404 });
    }

    if (comment.createdBy !== session.user.id) {
      return json({ error: 'You can only edit your own comments' }, { status: 403 });
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
  } catch (error) {
    console.error('Error updating comment:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  try {
    const session = await locals.auth();
    if (!session?.user?.id) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }

    const commentId = params.commentId;
    if (!commentId) {
      return json({ error: 'Invalid comment ID' }, { status: 400 });
    }

    const db = mongo.db();
    const commentsCollection = db.collection<Comment>('comments');
    const postsCollection = db.collection<Post>('posts');

    // Check if comment exists and user owns it
    const comment = await commentsCollection.findOne({ id: commentId });
    if (!comment) {
      return json({ error: 'Comment not found' }, { status: 404 });
    }

    // Check permissions (owner or canEdit)
    let canDelete = false;
    const isOwner = comment.createdBy === session.user.id;
    const post = await postsCollection.findOne({ id: comment.postId });
    if (!post) {
      return json({ error: 'Post not found' }, { status: 404 });
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

    if (!canDelete) {
      return json({ error: 'Permission denied' }, { status: 403 });
    }

    // Delete comment and all its replies
    const deleteResult = await commentsCollection.deleteMany({
      $or: [{ id: commentId }, { parentCommentId: commentId }]
    });

    // Delete votes on the comment
    await db.collection<CommentVote>('comment_votes').deleteMany({ commentId });

    // Update post comment count
    await postsCollection.updateOne(
      { id: comment.postId },
      {
        $inc: { commentCount: -deleteResult.deletedCount },
        $set: { updatedAt: new Date() }
      }
    );

    return json({ success: true });
  } catch (error) {
    console.error('Error deleting comment:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};
