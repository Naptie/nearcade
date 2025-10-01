import { json, error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import {
  type Post,
  type PostWithAuthor,
  type PostVote,
  type Comment,
  type CommentWithAuthorAndVote,
  type University,
  type Club,
  PostReadability
} from '$lib/types';
import {
  checkUniversityPermission,
  checkClubPermission,
  validatePostReadability,
  canReadPost,
  getDefaultPostReadability
} from '$lib/utils';

export const GET: RequestHandler = async ({ locals, params }) => {
  try {
    const postId = params.postId;

    if (!postId) {
      error(400, 'Invalid post ID');
    }

    const db = mongo.db();
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
      error(404, 'Post not found');
    }

    const post = postResult[0];

    // Check if user can read this post based on its readability setting
    const canRead = await canReadPost(
      post.readability,
      { universityId: post.universityId, clubId: post.clubId },
      session?.user,
      mongo
    );

    if (!canRead) {
      error(403, 'Permission denied');
    }

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
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error fetching post details:', err);
    error(500, 'Internal server error');
  }
};

// PUT /api/posts/[postId] - Edit post (title/content) or manage post (pin/lock)
export const PUT: RequestHandler = async ({ locals, params, request }) => {
  try {
    const session = await locals.auth();
    if (!session?.user?.id) {
      error(401, 'Authentication required');
    }

    const postId = params.postId;
    if (!postId) {
      error(400, 'Invalid post ID');
    }

    const { title, content, readability, isPinned, isLocked } = (await request.json()) as {
      title?: string;
      content?: string;
      readability?: PostReadability;
      isPinned?: boolean;
      isLocked?: boolean;
    };

    const db = mongo.db();
    const postsCollection = db.collection<Post>('posts');

    // Find the post
    const post = await postsCollection.findOne({ id: postId });
    if (!post) {
      error(404, 'Post not found');
    }

    // Check permissions
    let canEdit = false;
    let canManage = false;
    let orgReadability: PostReadability = PostReadability.PUBLIC;

    if (post.universityId) {
      const university = await db
        .collection<University>('universities')
        .findOne({ id: post.universityId });
      if (university) {
        const permissions = await checkUniversityPermission(session.user, university, mongo);
        canEdit = permissions.canEdit;
        canManage = permissions.canEdit; // Only canEdit users can manage posts
        orgReadability = getDefaultPostReadability(university.postReadability);
      }
    } else if (post.clubId) {
      const club = await db.collection<Club>('clubs').findOne({ id: post.clubId });
      if (club) {
        const permissions = await checkClubPermission(session.user, club, mongo);
        canEdit = permissions.canEdit;
        canManage = permissions.canEdit; // Only canEdit users can manage posts
        orgReadability = getDefaultPostReadability(club.postReadability);
      }
    }

    // Determine what type of update this is
    const isContentUpdate = title !== undefined || content !== undefined;
    const isManagementUpdate = isPinned !== undefined || isLocked !== undefined;

    // Check permissions for content updates (owner or canEdit)
    if (isContentUpdate || readability !== undefined) {
      const isOwner = post.createdBy === session.user.id;
      if (!isOwner && !canEdit) {
        error(403, 'Permission denied');
      }
    }

    // Validate readability change if specified
    if (readability !== undefined) {
      const permissions = { canEdit, role: canEdit ? 'admin' : '' };

      if (
        !validatePostReadability(readability, orgReadability, permissions, session.user.userType)
      ) {
        return json(
          {
            error: 'Cannot set post readability more open than organization setting'
          },
          { status: 403 }
        );
      }
    }

    // Check permissions for management updates (only canEdit)
    if (isManagementUpdate && !canManage) {
      error(403, 'Permission denied');
    }

    // Build update object
    const updateData: Partial<Post> = {};

    if (title !== undefined) {
      updateData.title = title;
    }
    if (content !== undefined) {
      updateData.content = content;
    }
    if (readability !== undefined) {
      updateData.readability = readability;
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
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error updating post:', err);
    error(500, 'Internal server error');
  }
};

// DELETE /api/posts/[postId] - Delete post
export const DELETE: RequestHandler = async ({ locals, params }) => {
  try {
    const session = await locals.auth();
    if (!session?.user?.id) {
      error(401, 'Authentication required');
    }

    const postId = params.postId;
    if (!postId) {
      error(400, 'Invalid post ID');
    }

    const db = mongo.db();
    const postsCollection = db.collection<Post>('posts');

    // Find the post
    const post = await postsCollection.findOne({ id: postId });
    if (!post) {
      error(404, 'Post not found');
    }

    // Check permissions (owner or canEdit)
    let canDelete = false;
    const isOwner = post.createdBy === session.user.id;

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
      error(403, 'Permission denied');
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
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error deleting post:', err);
    error(500, 'Internal server error');
  }
};
