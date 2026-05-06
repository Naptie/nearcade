import { json, error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import {
  type Post,
  type PostWithAuthor,
  type PostVote,
  type Comment,
  type CommentVote,
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
  getDefaultPostReadability,
  protect
} from '$lib/utils';
import { m } from '$lib/paraglide/messages';
import {
  deleteImagesByIds,
  deleteImagesForOwner,
  hydrateEntitiesWithImages,
  normalizeImageIds,
  replaceOwnerImages
} from '$lib/images/index.server';

export const GET: RequestHandler = async ({ locals, params }) => {
  try {
    const postId = params.postId;

    if (!postId) {
      error(400, m.invalid_post_id());
    }

    const db = mongo.db();
    const postsCollection = db.collection<Post>('posts');
    const commentsCollection = db.collection<Comment>('comments');
    const session = locals.session;

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
            authorData: 0
          }
        }
      ])
      .toArray();

    if (postResult.length === 0) {
      error(404, m.post_not_found());
    }

    const [post] = await hydrateEntitiesWithImages(db, [
      { ...postResult[0], author: protect(postResult[0].author) }
    ]);

    // Check if user can read this post based on its readability setting
    const canRead = await canReadPost(
      post.readability,
      { universityId: post.universityId, clubId: post.clubId },
      session?.user,
      mongo
    );

    if (!canRead) {
      error(403, m.permission_denied());
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
            authorData: 0
          }
        },
        {
          $sort: { createdAt: 1 }
        }
      ])
      .toArray()
      .then((results) => results.map((r) => ({ ...r, author: protect(r.author) })));
    const hydratedComments = await hydrateEntitiesWithImages(db, comments);

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
      comments: hydratedComments,
      userVote
    });
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error fetching post details:', err);
    error(500, m.internal_server_error());
  }
};

// PUT /api/posts/[postId] - Edit post (title/content) or manage post (pin/lock)
export const PUT: RequestHandler = async ({ locals, params, request }) => {
  try {
    const session = locals.session;
    if (!session?.user?.id) {
      error(401, m.unauthorized());
    }

    const postId = params.postId;
    if (!postId) {
      error(400, m.invalid_post_id());
    }

    const { title, content, readability, isPinned, isLocked, images } = (await request.json()) as {
      title?: string;
      content?: string;
      readability?: PostReadability;
      isPinned?: boolean;
      isLocked?: boolean;
      images?: unknown;
    };
    const normalizedImageIds = images === undefined ? undefined : normalizeImageIds(images);

    const db = mongo.db();
    const postsCollection = db.collection<Post>('posts');

    // Find the post
    const post = await postsCollection.findOne({ id: postId });
    if (!post) {
      error(404, m.post_not_found());
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
    const isContentUpdate =
      title !== undefined || content !== undefined || normalizedImageIds !== undefined;
    const isManagementUpdate = isPinned !== undefined || isLocked !== undefined;

    // Check permissions for content updates (owner or canEdit)
    if (isContentUpdate || readability !== undefined) {
      const isOwner = post.createdBy === session.user.id;
      if (!isOwner && !canEdit) {
        error(403, m.permission_denied());
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
      error(403, m.permission_denied());
    }

    const trimmedTitle = title?.trim();
    const trimmedContent = content?.trim();
    const nextTitle = trimmedTitle ?? post.title;
    const nextContent = trimmedContent ?? post.content;
    const nextImageIds = normalizedImageIds ?? post.images ?? [];

    if (isContentUpdate) {
      if (!nextTitle) {
        error(400, m.title_and_content_are_required());
      }

      if (!nextContent && nextImageIds.length === 0) {
        error(400, m.title_and_content_are_required());
      }
    }

    // Build update object
    const updateData: Partial<Post> = {};

    if (title !== undefined) {
      updateData.title = nextTitle;
    }
    if (content !== undefined) {
      updateData.content = nextContent;
    }
    if (normalizedImageIds !== undefined) {
      await replaceOwnerImages(
        db,
        post.images ?? [],
        normalizedImageIds,
        { postId },
        { userId: session.user.id, userType: session.user.userType }
      );
      updateData.images = normalizedImageIds;
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
    error(500, m.internal_server_error());
  }
};

// DELETE /api/posts/[postId] - Delete post
export const DELETE: RequestHandler = async ({ locals, params }) => {
  try {
    const session = locals.session;
    if (!session?.user?.id) {
      error(401, m.unauthorized());
    }

    const postId = params.postId;
    if (!postId) {
      error(400, m.invalid_post_id());
    }

    const db = mongo.db();
    const postsCollection = db.collection<Post>('posts');

    // Find the post
    const post = await postsCollection.findOne({ id: postId });
    if (!post) {
      error(404, m.post_not_found());
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
      error(403, m.permission_denied());
    }

    const commentsCollection = db.collection<Comment>('comments');
    const comments = await commentsCollection
      .find({ postId: postId })
      .project({ id: 1, images: 1 })
      .toArray();
    const commentIds = comments.map((comment) => comment.id);
    const commentImageIds = comments.flatMap((comment) => comment.images ?? []);

    if ((post.images?.length ?? 0) > 0) {
      await deleteImagesForOwner(
        db,
        { postId },
        {
          userId: session.user.id,
          userType: session.user.userType,
          skipPermissionCheck: true
        }
      );
    }

    if (commentImageIds.length > 0) {
      await deleteImagesByIds(db, commentImageIds, {
        userId: session.user.id,
        userType: session.user.userType,
        skipPermissionCheck: true
      });
    }

    await commentsCollection.deleteMany({ postId: postId });

    if (commentIds.length > 0) {
      await db
        .collection<CommentVote>('comment_votes')
        .deleteMany({ commentId: { $in: commentIds } });
    }

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
    error(500, m.internal_server_error());
  }
};
