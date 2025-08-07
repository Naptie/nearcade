import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import client from '$lib/db.server';
import type { Post, PostWithAuthor, PostVote, Comment, CommentWithAuthor } from '$lib/types';

export const GET: RequestHandler = async ({ locals, params }) => {
  try {
    const postId = params.postId;

    if (!postId) {
      return json({ error: 'Invalid post ID' }, { status: 400 });
    }

    const db = client.db();
    const postsCollection = db.collection<Post>('posts');
    const commentsCollection = db.collection<Comment>('comments');

    // Get post with author info
    const postResult = await postsCollection
      .aggregate<PostWithAuthor>([
        {
          $match: { id: postId }
        },
        {
          $lookup: {
            from: 'users',
            localField: 'createdBy',
            foreignField: 'id',
            as: 'authorData'
          }
        },
        {
          $addFields: {
            author: {
              $arrayElemAt: ['$authorData', 0]
            }
          }
        },
        {
          $project: {
            authorData: 0,
            'author._id': 0,
            'author.email': 0
          }
        }
      ])
      .toArray();

    if (postResult.length === 0) {
      return json({ error: 'Post not found' }, { status: 404 });
    }

    const post = postResult[0];

    // Get comments for this post
    const comments = await commentsCollection
      .aggregate<CommentWithAuthor>([
        {
          $match: { postId: postId }
        },
        {
          $lookup: {
            from: 'users',
            localField: 'createdBy',
            foreignField: 'id',
            as: 'authorData'
          }
        },
        {
          $addFields: {
            author: {
              $arrayElemAt: ['$authorData', 0]
            }
          }
        },
        {
          $project: {
            authorData: 0,
            'author._id': 0,
            'author.email': 0
          }
        },
        {
          $sort: { createdAt: 1 }
        }
      ])
      .toArray();

    // Get user's vote if logged in
    let userVote = null;
    const session = await locals.auth();
    if (session?.user?.id) {
      const votesCollection = db.collection<PostVote>('post_votes');
      const vote = await votesCollection.findOne({
        postId: postId,
        userId: session.user.id
      });
      userVote = vote ? vote.voteType : null;
    }

    return json({
      post,
      comments,
      userVote
    });
  } catch (error) {
    console.error('Error fetching post details:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};
