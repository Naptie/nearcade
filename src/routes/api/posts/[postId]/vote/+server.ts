import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import client from '$lib/db.server';
import type { Post, PostVote } from '$lib/types';
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

    const { voteType } = (await request.json()) as { voteType: 'upvote' | 'downvote' };
    if (!voteType || !['upvote', 'downvote'].includes(voteType)) {
      return json({ error: 'Invalid vote type' }, { status: 400 });
    }

    const db = client.db();
    const postsCollection = db.collection<Post>('posts');
    const votesCollection = db.collection<PostVote>('post_votes');

    // Check if post exists
    const post = await postsCollection.findOne({ id: postId });
    if (!post) {
      return json({ error: 'Post not found' }, { status: 404 });
    }

    // Check if user already voted
    const existingVote = await votesCollection.findOne({
      postId: postId,
      userId: session.user.id
    });

    let upvoteDelta = 0;
    let downvoteDelta = 0;

    if (existingVote) {
      // User already voted
      if (existingVote.voteType === voteType) {
        // Same vote - remove it (toggle off)
        await votesCollection.deleteOne({ _id: existingVote._id });

        if (voteType === 'upvote') {
          upvoteDelta = -1;
        } else {
          downvoteDelta = -1;
        }
      } else {
        // Different vote - change it
        await votesCollection.updateOne(
          { _id: existingVote._id },
          {
            $set: {
              voteType: voteType,
              updatedAt: new Date()
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
      }
    } else {
      // New vote
      const newVote: PostVote = {
        id: nanoid(),
        postId: postId,
        userId: session.user.id,
        voteType: voteType,
        createdAt: new Date()
      };

      await votesCollection.insertOne(newVote);

      if (voteType === 'upvote') {
        upvoteDelta = 1;
      } else {
        downvoteDelta = 1;
      }
    }

    // Update post vote counts
    await postsCollection.updateOne(
      { id: postId },
      {
        $inc: {
          upvotes: upvoteDelta,
          downvotes: downvoteDelta
        },
        $set: {
          updatedAt: new Date()
        }
      }
    );

    // Get updated post data
    const updatedPost = await postsCollection.findOne({ id: postId });
    const currentUserVote = await votesCollection.findOne({
      postId: postId,
      userId: session.user.id
    });

    return json({
      success: true,
      upvotes: updatedPost?.upvotes || 0,
      downvotes: updatedPost?.downvotes || 0,
      userVote: currentUserVote ? currentUserVote.voteType : null
    });
  } catch (error) {
    console.error('Error voting on post:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};
