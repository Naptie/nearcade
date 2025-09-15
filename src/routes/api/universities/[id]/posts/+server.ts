import { json } from '@sveltejs/kit';
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
  canReadPost
} from '$lib/utils';

export const GET: RequestHandler = async ({ locals, params, url }) => {
  try {
    const session = await locals.auth();
    const universityId = params.id;
    const page = parseInt(url.searchParams.get('page') || '1');
    const skip = (page - 1) * PAGINATION.PAGE_SIZE;

    if (!universityId) {
      return json({ error: 'Invalid university ID' }, { status: 400 });
    }

    const db = mongo.db();
    const universitiesCollection = db.collection<University>('universities');
    const postsCollection = db.collection<Post>('posts');

    // Check if university exists
    const university = await universitiesCollection.findOne({
      $or: [{ id: universityId }, { slug: universityId }]
    });
    if (!university) {
      return json({ error: 'University not found' }, { status: 404 });
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
            authorData: 0,
            'author._id': 0,
            'author.email': 0
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
        readablePosts.push(post);
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
  } catch (error) {
    console.error('Error fetching university posts:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  try {
    const session = await locals.auth();
    if (!session?.user?.id) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }

    const universityId = params.id;
    if (!universityId) {
      return json({ error: 'Invalid university ID' }, { status: 400 });
    }

    const { title, content, readability } = (await request.json()) as {
      title: string;
      content: string;
      readability?: PostReadability;
    };
    if (!title || !content) {
      return json({ error: 'Title and content are required' }, { status: 400 });
    }

    const db = mongo.db();
    const universitiesCollection = db.collection<University>('universities');
    const postsCollection = db.collection<Post>('posts');

    // Check if university exists
    const university = await universitiesCollection.findOne({
      $or: [{ id: universityId }, { slug: universityId }]
    });
    if (!university) {
      return json({ error: 'University not found' }, { status: 404 });
    }

    // Check post writability permissions
    const permissions = await checkUniversityPermission(session.user, university, mongo);

    if (!canWriteUnivPosts(permissions, university)) {
      return json({ error: 'Permission denied' }, { status: 403 });
    }

    // Determine post readability
    const orgReadability = getDefaultPostReadability(university.postReadability);
    let postReadability: PostReadability;

    if (readability !== undefined) {
      // Validate if user can set this readability level
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
      postReadability = readability;
    } else {
      // Use default readability
      postReadability = orgReadability;
    }

    // Create new post
    const newPost: Post = {
      id: postId(),
      title: title.trim(),
      content: content.trim(),
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

    return json({ success: true, postId: newPost.id }, { status: 201 });
  } catch (error) {
    console.error('Error creating university post:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};
