import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import client from '$lib/db.server';
import type { Comment, CommentVote, Post } from '$lib/types';

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

    const db = client.db();
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

    const db = client.db();
    const commentsCollection = db.collection<Comment>('comments');
    const postsCollection = db.collection<Post>('posts');

    // Check if comment exists and user owns it
    const comment = await commentsCollection.findOne({ id: commentId });
    if (!comment) {
      return json({ error: 'Comment not found' }, { status: 404 });
    }

    if (comment.createdBy !== session.user.id) {
      return json({ error: 'You can only delete your own comments' }, { status: 403 });
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
