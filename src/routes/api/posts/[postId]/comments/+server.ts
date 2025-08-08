import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import client from '$lib/db.server';
import type { Post, Comment, University, Club } from '$lib/types';
import { nanoid } from 'nanoid';
import { checkUniversityPermission, checkClubPermission } from '$lib/utils';

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

    // Check if post is locked and user has permission to comment
    if (post.isLocked) {
      let canInteract = false;

      if (post.universityId) {
        const university = await db.collection<University>('universities').findOne({ id: post.universityId });
        if (university) {
          const permissions = await checkUniversityPermission(session.user, university, client);
          canInteract = permissions.canEdit;
        }
      } else if (post.clubId) {
        const club = await db.collection<Club>('clubs').findOne({ id: post.clubId });
        if (club) {
          const permissions = await checkClubPermission(session.user, club, client);
          canInteract = permissions.canEdit;
        }
      }

      if (!canInteract) {
        return json({ error: 'Post is locked' }, { status: 403 });
      }
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
        $inc: { commentCount: 1 }
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
