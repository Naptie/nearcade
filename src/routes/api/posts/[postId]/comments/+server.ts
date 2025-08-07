import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import client from '$lib/db.server';
import type { Post, Comment } from '$lib/types';
import { nanoid } from 'nanoid';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  try {
    const session = await locals.auth();
    if (!session?.user?.id) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }

    const postId = params.postId;
    if (!postId) {
      return json({ error: 'Invalid post ID' }, { status: 400 });
    }

    const { content, parentCommentId } = (await request.json()) as {
      content: string;
      parentCommentId?: string;
    };
    if (!content || !content.trim()) {
      return json({ error: 'Comment content is required' }, { status: 400 });
    }

    const db = client.db();
    const postsCollection = db.collection<Post>('posts');
    const commentsCollection = db.collection<Comment>('comments');

    // Check if post exists
    const post = await postsCollection.findOne({ id: postId });
    if (!post) {
      return json({ error: 'Post not found' }, { status: 404 });
    }

    // If replying to a comment, check if parent comment exists
    if (parentCommentId) {
      const parentComment = await commentsCollection.findOne({ id: parentCommentId });
      if (!parentComment) {
        return json({ error: 'Parent comment not found' }, { status: 404 });
      }
    }

    // Create new comment
    const newComment: Comment = {
      id: nanoid(),
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
        $inc: { commentCount: 1 },
        $set: { updatedAt: new Date() }
      }
    );

    return json(
      {
        success: true,
        commentId: newComment.id
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating comment:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};
