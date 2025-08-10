import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PAGINATION } from '$lib/constants';
import client from '$lib/db.server';
import { type Post, type PostWithAuthor, type Club, PostReadability } from '$lib/types';
import {
  postId,
  checkClubPermission,
  canWriteClubPosts,
  checkUniversityPermission,
  getDefaultPostReadability,
  validatePostReadability,
  canReadPost
} from '$lib/utils';

export const GET: RequestHandler = async ({ locals, params, url }) => {
  try {
    const session = await locals.auth();
    const clubId = params.id;
    const page = parseInt(url.searchParams.get('page') || '1');
    const skip = (page - 1) * PAGINATION.PAGE_SIZE;

    if (!clubId) {
      return json({ error: 'Invalid club ID' }, { status: 400 });
    }

    const db = client.db();
    const clubsCollection = db.collection<Club>('clubs');
    const postsCollection = db.collection<Post>('posts');

    // Check if club exists
    const club = await clubsCollection.findOne({
      $or: [{ id: clubId }, { slug: clubId }]
    });
    if (!club) {
      return json({ error: 'Club not found' }, { status: 404 });
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
        client
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
    console.error('Error fetching club posts:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  try {
    const session = await locals.auth();
    if (!session?.user?.id) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }

    const clubId = params.id;
    if (!clubId) {
      return json({ error: 'Invalid club ID' }, { status: 400 });
    }

    const { title, content, readability } = (await request.json()) as { 
      title: string; 
      content: string;
      readability?: PostReadability;
    };
    if (!title || !content) {
      return json({ error: 'Title and content are required' }, { status: 400 });
    }

    const db = client.db();
    const clubsCollection = db.collection<Club>('clubs');
    const postsCollection = db.collection<Post>('posts');

    // Check if club exists
    const club = await clubsCollection.findOne({
      $or: [{ id: clubId }, { slug: clubId }]
    });
    if (!club) {
      return json({ error: 'Club not found' }, { status: 404 });
    }

    // Check post writability permissions
    const permissions = await checkClubPermission(session.user, club, client);

    if (!(await canWriteClubPosts(permissions, club, session.user, client))) {
      return json({ error: 'Permission denied' }, { status: 403 });
    }

    // Determine post readability
    const orgReadability = club.postReadability ?? PostReadability.CLUB_MEMBERS;
    let postReadability: PostReadability;

    if (readability !== undefined) {
      // Validate if user can set this readability level
      // Note: For clubs, CLUB_MEMBERS readability is invalid for universities
      if (readability === PostReadability.UNIV_MEMBERS) {
        // This is allowed for club posts - it means university members can read
        postReadability = readability;
      } else if (!validatePostReadability(readability, orgReadability, permissions, session.user.userType)) {
        return json({ 
          error: 'Cannot set post readability more open than organization setting' 
        }, { status: 403 });
      } else {
        postReadability = readability;
      }
    } else {
      // Use default readability
      postReadability = getDefaultPostReadability(orgReadability, 'club');
    }

    // Create new post
    const newPost: Post = {
      id: postId(),
      title: title.trim(),
      content: content.trim(),
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

    return json({ success: true, postId: newPost.id }, { status: 201 });
  } catch (error) {
    console.error('Error creating club post:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};
