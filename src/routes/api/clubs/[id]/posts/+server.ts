import { json, error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PAGINATION } from '$lib/constants';
import mongo from '$lib/db/index.server';
import { type Post, type PostWithAuthor, type Club, PostReadability } from '$lib/types';
import {
  postId,
  checkClubPermission,
  canWriteClubPosts,
  getDefaultPostReadability,
  validatePostReadability,
  canReadPost,
  protect,
  toPlainObject
} from '$lib/utils';
import { m } from '$lib/paraglide/messages';
import { attachImagesToOwner } from '$lib/images/index.server';
import { withExistingImages } from '$lib/images/validation.server';
import {
  organizationPostsQuerySchema,
  organizationPostsResponseSchema,
  postCreateRequestSchema,
  postCreateResponseSchema
} from '$lib/schemas/posts';
import { clubIdParamSchema } from '$lib/schemas/organizations';
import {
  parseJsonOrError,
  parseParamsOrError,
  parseQueryOrError
} from '$lib/utils/validation.server';

const postCreateRequestWithExistingImagesSchema = withExistingImages(postCreateRequestSchema);

export const GET: RequestHandler = async ({ locals, params, url }) => {
  try {
    const session = locals.session;
    const { id: clubId } = parseParamsOrError(clubIdParamSchema, params);
    const { page } = parseQueryOrError(organizationPostsQuerySchema, url);
    const skip = (page - 1) * PAGINATION.PAGE_SIZE;

    const db = mongo.db();
    const clubsCollection = db.collection<Club>('clubs');
    const postsCollection = db.collection<Post>('posts');

    // Check if club exists
    const club = await clubsCollection.findOne({
      $or: [{ id: clubId }, { slug: clubId }]
    });
    if (!club) {
      error(404, m.club_not_found());
    }

    // Check post readability permissions - now using post-level readability
    // Get posts and filter based on individual post readability
    const allPosts = await postsCollection
      .aggregate<PostWithAuthor>([
        {
          $match: { clubId: club.id }
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
        },
        {
          $sort: { isPinned: -1, createdAt: -1 }
        }
      ])
      .toArray();

    // Filter posts based on readability permissions
    const readablePosts: PostWithAuthor[] = [];
    for (const post of allPosts) {
      const canRead = await canReadPost(
        post.readability,
        { universityId: post.universityId, clubId: post.clubId },
        session?.user,
        mongo
      );
      if (canRead) {
        const readablePost = { ...post, author: protect(post.author) };
        readablePosts.push(readablePost);
      }
    }

    // Apply pagination after filtering
    const hasMore = readablePosts.length > skip + PAGINATION.PAGE_SIZE;
    const posts = readablePosts.slice(skip, skip + PAGINATION.PAGE_SIZE);

    return json(
      organizationPostsResponseSchema.parse(
        toPlainObject({
          posts,
          hasMore,
          page
        })
      )
    );
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error fetching club posts:', err);
    error(500, m.internal_server_error());
  }
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  try {
    const session = locals.session;
    if (!session?.user?.id) {
      error(401, m.unauthorized());
    }

    const { id: clubId } = parseParamsOrError(clubIdParamSchema, params);

    const {
      title: trimmedTitle,
      content: trimmedContent,
      readability,
      images: imageIds
    } = await parseJsonOrError(request, postCreateRequestWithExistingImagesSchema);

    const db = mongo.db();
    const clubsCollection = db.collection<Club>('clubs');
    const postsCollection = db.collection<Post>('posts');

    // Check if club exists
    const club = await clubsCollection.findOne({
      $or: [{ id: clubId }, { slug: clubId }]
    });
    if (!club) {
      error(404, m.club_not_found());
    }

    // Check post writability permissions
    const permissions = await checkClubPermission(session.user, club, mongo);

    if (!(await canWriteClubPosts(permissions, club, session.user, mongo))) {
      error(403, m.permission_denied());
    }

    // Determine post readability
    const orgReadability = getDefaultPostReadability(club.postReadability);
    let postReadability: PostReadability;

    if (readability !== undefined) {
      // Validate if user can set this readability level
      // Note: For clubs, CLUB_MEMBERS readability is invalid for universities
      if (readability === PostReadability.UNIV_MEMBERS) {
        // This is allowed for club posts - it means university members can read
        postReadability = readability;
      } else if (
        !validatePostReadability(readability, orgReadability, permissions, session.user.userType)
      ) {
        return json(
          {
            error: 'Cannot set post readability more open than organization setting'
          },
          { status: 403 }
        );
      } else {
        postReadability = readability;
      }
    } else {
      // Use default readability
      postReadability = orgReadability;
    }

    // Create new post
    const newPost: Post = {
      id: postId(),
      title: trimmedTitle,
      content: trimmedContent,
      images: imageIds,
      clubId: club.id,
      createdBy: session.user.id,
      createdAt: new Date(),
      upvotes: 0,
      downvotes: 0,
      commentCount: 0,
      isPinned: false,
      isLocked: false,
      readability: postReadability
    };

    await postsCollection.insertOne(newPost);

    try {
      if (imageIds.length > 0) {
        await attachImagesToOwner(
          db,
          imageIds,
          { postId: newPost.id },
          { userId: session.user.id, userType: session.user.userType }
        );
      }
    } catch (attachmentError) {
      await postsCollection.deleteOne({ id: newPost.id });
      throw attachmentError;
    }

    return json(postCreateResponseSchema.parse({ success: true, postId: newPost.id }), {
      status: 201
    });
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error creating club post:', err);
    error(500, m.internal_server_error());
  }
};
