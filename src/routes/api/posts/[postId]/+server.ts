import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import client from '$lib/db.server';
import type {
  Post,
  PostWithAuthor,
  PostVote,
  Comment,
  CommentWithAuthorAndVote,
  University,
  Club
} from '$lib/types';
import { checkUniversityPermission, checkClubPermission } from '$lib/utils';

export const GET: RequestHandler = async ({ locals, params }) => {
  try {
    const postId = params.postId;

    if (!postId) {
      return json({ error: 'Invalid post ID' }, { status: 400 });
    }

    const db = client.db();
    const postsCollection = db.collection<Post>('posts');
    const commentsCollection = db.collection<Comment>('comments');
    const session = await locals.auth();

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
      .aggregate<CommentWithAuthorAndVote>([
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
          $lookup: {
            from: 'comment_votes',
            localField: 'id',
            foreignField: 'commentId',
            as: 'commentVoteData'
          }
        },
        {
          $addFields: {
            author: {
              $arrayElemAt: ['$authorData', 0]
            },
            vote: {
              $arrayElemAt: [
                {
                  $filter: {
                    input: '$commentVoteData',
                    as: 'vote',
                    cond: { $eq: ['$$vote.userId', session?.user?.id] }
                  }
                },
                0
              ]
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

// PUT /api/posts/[postId] - Edit post (title/content) or manage post (pin/lock)
export const PUT: RequestHandler = async ({ locals, params, request }) => {
  try {
    const session = await locals.auth();
    if (!session?.user?.id) {
      return json({ error: 'Authentication required' }, { status: 401 });
    }

    const postId = params.postId;
    if (!postId) {
      return json({ error: 'Invalid post ID' }, { status: 400 });
    }

    const { title, content, isPinned, isLocked } = (await request.json()) as {
      title?: string;
      content?: string;
      isPinned?: boolean;
      isLocked?: boolean;
    };

    const db = client.db();
    const postsCollection = db.collection<Post>('posts');

    // Find the post
    const post = await postsCollection.findOne({ id: postId });
    if (!post) {
      return json({ error: 'Post not found' }, { status: 404 });
    }

    // Check permissions
    let canEdit = false;
    let canManage = false;

    if (post.universityId) {
      const university = await db
        .collection<University>('universities')
        .findOne({ id: post.universityId });
      if (university) {
        const permissions = await checkUniversityPermission(session.user, university, client);
        canEdit = permissions.canEdit;
        canManage = permissions.canEdit; // Only canEdit users can manage posts
      }
    } else if (post.clubId) {
      const club = await db.collection<Club>('clubs').findOne({ id: post.clubId });
      if (club) {
        const permissions = await checkClubPermission(session.user, club, client);
        canEdit = permissions.canEdit;
        canManage = permissions.canEdit; // Only canEdit users can manage posts
      }
    }

    // Determine what type of update this is
    const isContentUpdate = title !== undefined || content !== undefined;
    const isManagementUpdate = isPinned !== undefined || isLocked !== undefined;

    // Check permissions for content updates (owner or canEdit)
    if (isContentUpdate) {
      const isOwner = post.createdBy === session.user.id;
      if (!isOwner && !canEdit) {
        return json({ error: 'Permission denied' }, { status: 403 });
      }
    }

    // Check permissions for management updates (only canEdit)
    if (isManagementUpdate && !canManage) {
      return json({ error: 'Permission denied' }, { status: 403 });
    }

    // Build update object
    const updateData: Partial<Post> = {};

    if (title !== undefined) {
      updateData.title = title;
    }
    if (content !== undefined) {
      updateData.content = content;
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

    // Update the post
    await postsCollection.updateOne({ id: postId }, { $set: updateData });

    return json({ success: true });
  } catch (error) {
    console.error('Error updating post:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};

// DELETE /api/posts/[postId] - Delete post
export const DELETE: RequestHandler = async ({ locals, params }) => {
  try {
    const session = await locals.auth();
    if (!session?.user?.id) {
      return json({ error: 'Authentication required' }, { status: 401 });
    }

    const postId = params.postId;
    if (!postId) {
      return json({ error: 'Invalid post ID' }, { status: 400 });
    }

    const db = client.db();
    const postsCollection = db.collection<Post>('posts');

    // Find the post
    const post = await postsCollection.findOne({ id: postId });
    if (!post) {
      return json({ error: 'Post not found' }, { status: 404 });
    }

    // Check permissions (owner or canEdit)
    let canDelete = false;
    const isOwner = post.createdBy === session.user.id;

    if (post.universityId) {
      const university = await db
        .collection<University>('universities')
        .findOne({ id: post.universityId });
      if (university) {
        const permissions = await checkUniversityPermission(session.user, university, client);
        canDelete = isOwner || permissions.canEdit;
      }
    } else if (post.clubId) {
      const club = await db.collection<Club>('clubs').findOne({ id: post.clubId });
      if (club) {
        const permissions = await checkClubPermission(session.user, club, client);
        canDelete = isOwner || permissions.canEdit;
      }
    }

    if (!canDelete) {
      return json({ error: 'Permission denied' }, { status: 403 });
    }

    // Delete all comments associated with this post
    const commentsCollection = db.collection('comments');
    await commentsCollection.deleteMany({ postId: postId });

    // Delete all votes associated with this post
    const votesCollection = db.collection('post_votes');
    await votesCollection.deleteMany({ postId: postId });

    // Delete the post
    await postsCollection.deleteOne({ id: postId });

    return json({ success: true });
  } catch (error) {
    console.error('Error deleting post:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};
