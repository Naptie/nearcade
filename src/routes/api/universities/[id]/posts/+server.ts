import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PAGINATION } from '$lib/constants';
import client from '$lib/db.server';
import type {
  Post,
  PostWithAuthor,
  University,
  PostReadability,
  PostWritability
} from '$lib/types';
import { postId, checkUniversityPermission } from '$lib/utils';

export const GET: RequestHandler = async ({ locals, params, url }) => {
  try {
    const session = await locals.auth();
    const universityId = params.id;
    const page = parseInt(url.searchParams.get('page') || '1');
    const skip = (page - 1) * PAGINATION.PAGE_SIZE;

    if (!universityId) {
      return json({ error: 'Invalid university ID' }, { status: 400 });
    }

    const db = client.db();
    const universitiesCollection = db.collection<University>('universities');
    const postsCollection = db.collection<Post>('posts');

    // Check if university exists
    const university = await universitiesCollection.findOne({
      $or: [{ id: universityId }, { slug: universityId }]
    });
    if (!university) {
      return json({ error: 'University not found' }, { status: 404 });
    }

    // Check post readability permissions
    const postReadability = university.postReadability ?? PostReadability.PUBLIC;
    let canReadPosts = true;

    if (postReadability === PostReadability.UNIV_MEMBERS) {
      if (!session?.user?.id) {
        canReadPosts = false;
      } else {
        const permissions = await checkUniversityPermission(session.user, university, client);
        canReadPosts = permissions.canJoin <= 1; // Member or can join (meaning already member)
      }
    }

    if (!canReadPosts) {
      return json({ error: 'Permission denied' }, { status: 403 });
    }

    // Get posts for this university
    const posts = await postsCollection
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
        },
        { $skip: skip },
        { $limit: PAGINATION.PAGE_SIZE + 1 }
      ])
      .toArray();

    const hasMore = posts.length > PAGINATION.PAGE_SIZE;
    if (hasMore) {
      posts.pop(); // Remove extra item used for hasMore check
    }

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

    const { title, content } = (await request.json()) as { title: string; content: string };
    if (!title || !content) {
      return json({ error: 'Title and content are required' }, { status: 400 });
    }

    const db = client.db();
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
    const postWritability = university.postWritability ?? PostWritability.UNIV_MEMBERS;
    let canWritePosts = false;

    if (postWritability === PostWritability.UNIV_MEMBERS) {
      const permissions = await checkUniversityPermission(session.user, university, client);
      canWritePosts = permissions.canJoin <= 1; // Member or can join (meaning already member)
    } else if (postWritability === PostWritability.ADMIN_AND_MODS) {
      const permissions = await checkUniversityPermission(session.user, university, client);
      canWritePosts = permissions.canEdit;
    }

    if (!canWritePosts) {
      return json({ error: 'Permission denied' }, { status: 403 });
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
      isLocked: false
    };

    await postsCollection.insertOne(newPost);

    return json({ success: true, postId: newPost.id }, { status: 201 });
  } catch (error) {
    console.error('Error creating university post:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};
