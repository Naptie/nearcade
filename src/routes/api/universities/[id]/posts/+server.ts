import { json, error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PAGINATION } from '$lib/constants';
import mongo from '$lib/db/index.server';
import { type Post, type PostWithAuthor, type University, PostReadability } from '$lib/types';
import {
  postId,
  checkUniversityPermission,
  canWriteUnivPosts,
  getDefaultPostReadability,
  validatePostReadability,
  canReadPost,
  protect
} from '$lib/utils';
import { m } from '$lib/paraglide/messages';
import { attachImagesToOwner } from '$lib/images/index.server';
import { withExistingImages } from '$lib/images/validation.server';
import { postCreateRequestSchema } from '$lib/schemas/posts.server';
import { parseJsonOrError } from '$lib/utils/validation.server';

const postCreateRequestWithExistingImagesSchema = withExistingImages(postCreateRequestSchema);

export const GET: RequestHandler = async ({ locals, params, url }) => {
  try {
    const session = locals.session;
    const universityId = params.id;
    const page = parseInt(url.searchParams.get('page') || '1');
    const skip = (page - 1) * PAGINATION.PAGE_SIZE;

    if (!universityId) {
      error(400, m.invalid_university_id());
    }

    const db = mongo.db();
    const universitiesCollection = db.collection<University>('universities');
    const postsCollection = db.collection<Post>('posts');

    // Check if university exists
    const university = await universitiesCollection.findOne({
      $or: [{ id: universityId }, { slug: universityId }]
    });
    if (!university) {
      error(404, m.university_not_found());
    }

    // Check post readability permissions - now using post-level readability
    // Get posts and filter based on individual post readability
    const allPosts = await postsCollection
      .aggregate<PostWithAuthor>([
        {
          $match: { universityId: university.id }
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

    return json({
      posts,
      hasMore,
      page
    });
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error fetching university posts:', err);
    error(500, m.internal_server_error());
  }
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  try {
    const session = locals.session;
    if (!session?.user?.id) {
      error(401, m.unauthorized());
    }

    const universityId = params.id;
    if (!universityId) {
      error(400, m.invalid_university_id());
    }

    const {
      title: trimmedTitle,
      content: trimmedContent,
      readability,
      images: imageIds
    } = await parseJsonOrError(request, postCreateRequestWithExistingImagesSchema);

    const db = mongo.db();
    const universitiesCollection = db.collection<University>('universities');
    const postsCollection = db.collection<Post>('posts');

    // Check if university exists
    const university = await universitiesCollection.findOne({
      $or: [{ id: universityId }, { slug: universityId }]
    });
    if (!university) {
      error(404, m.university_not_found());
    }

    // Check post writability permissions
    const permissions = await checkUniversityPermission(session.user, university, mongo);

    if (!canWriteUnivPosts(permissions, university)) {
      error(403, m.permission_denied());
    }

    // Determine post readability
    const orgReadability = getDefaultPostReadability(university.postReadability);
    let postReadability: PostReadability;

    if (readability !== undefined) {
      // Validate if user can set this readability level
      if (
        !validatePostReadability(readability, orgReadability, permissions, session.user.userType)
      ) {
        error(403, m.cannot_set_post_readability_more_open_than_organization_setting());
      }
      postReadability = readability;
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
      universityId: university.id,
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

    return json({ success: true, postId: newPost.id }, { status: 201 });
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error creating university post:', err);
    error(500, m.internal_server_error());
  }
};
