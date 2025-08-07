import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import client from '$lib/db.server';
import type { Comment, CommentVote } from '$lib/types';
import { nanoid } from 'nanoid';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  try {
    const session = await locals.auth();
    if (!session?.user?.id) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }

    const commentId = params.commentId;
    if (!commentId) {
      return json({ error: 'Invalid comment ID' }, { status: 400 });
    }

    const { voteType } = (await request.json()) as {
      voteType: 'upvote' | 'downvote';
    };
    if (!voteType || !['upvote', 'downvote'].includes(voteType)) {
      return json({ error: 'Invalid vote type' }, { status: 400 });
    }

    const db = client.db();
    const commentsCollection = db.collection<Comment>('comments');
    const votesCollection = db.collection<CommentVote>('comment_votes');

    // Check if comment exists
    const comment = await commentsCollection.findOne({ id: commentId });
    if (!comment) {
      return json({ error: 'Comment not found' }, { status: 404 });
    }

    // Check for existing vote
    const existingVote = await votesCollection.findOne({
      commentId: commentId,
      userId: session.user.id
    });

    const userId = session.user.id;
    let upvoteDelta = 0;
    let downvoteDelta = 0;
    let newUserVote: 'upvote' | 'downvote' | null = null;

    if (existingVote) {
      if (existingVote.voteType === voteType) {
        // Remove vote (toggle off)
        await votesCollection.deleteOne({
          commentId: commentId,
          userId: userId
        });
        
        if (voteType === 'upvote') {
          upvoteDelta = -1;
        } else {
          downvoteDelta = -1;
        }
        newUserVote = null;
      } else {
        // Change vote type
        await votesCollection.updateOne(
          {
            commentId: commentId,
            userId: userId
          },
          {
            $set: {
              voteType: voteType,
              createdAt: new Date()
            }
          }
        );
        
        if (voteType === 'upvote') {
          upvoteDelta = 1;
          downvoteDelta = -1;
        } else {
          upvoteDelta = -1;
          downvoteDelta = 1;
        }
        newUserVote = voteType;
      }
    } else {
      // Create new vote
      const newVote: CommentVote = {
        id: nanoid(),
        commentId: commentId,
        userId: userId,
        voteType: voteType,
        createdAt: new Date()
      };
      
      await votesCollection.insertOne(newVote);
      
      if (voteType === 'upvote') {
        upvoteDelta = 1;
      } else {
        downvoteDelta = 1;
      }
      newUserVote = voteType;
    }

    // Update comment vote counts
    await commentsCollection.updateOne(
      { id: commentId },
      {
        $inc: {
          upvotes: upvoteDelta,
          downvotes: downvoteDelta
        }
      }
    );

    // Get updated vote counts
    const updatedComment = await commentsCollection.findOne({ id: commentId });
    if (!updatedComment) {
      return json({ error: 'Failed to get updated comment' }, { status: 500 });
    }

    return json({
      success: true,
      upvotes: updatedComment.upvotes,
      downvotes: updatedComment.downvotes,
      userVote: newUserVote
    });
  } catch (error) {
    console.error('Error voting on comment:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};