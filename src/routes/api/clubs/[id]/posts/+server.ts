import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PAGINATION } from '$lib/constants';
import client from '$lib/db.server';
import {
  type Post,
  type PostWithAuthor,
  type Club,
  PostReadability,
  PostWritability
} from '$lib/types';
import { postId, checkClubPermission } from '$lib/utils';

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

    // Check post readability permissions
    const postReadability = club.postReadability ?? PostReadability.CLUB_MEMBERS;
    let canReadPosts = true;

    if (
      postReadability === PostReadability.CLUB_MEMBERS ||
      postReadability === PostReadability.UNIV_MEMBERS
    ) {
      if (!session?.user?.id) {
        canReadPosts = false;
      } else {
        const permissions = await checkClubPermission(session.user, club, client);
        if (postReadability === PostReadability.CLUB_MEMBERS) {
          canReadPosts = permissions.canJoin <= 1; // Member or can join (meaning already member)
        } else {
          // UNIV_MEMBERS - check if user is member of university
          canReadPosts = permissions.canJoin <= 2; // Can join club means they're in university
        }
      }
    }

    if (!canReadPosts) {
      return json({ error: 'Permission denied' }, { status: 403 });
    }

    // Get posts for this club
    const posts = await postsCollection
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

    const { title, content } = (await request.json()) as { title: string; content: string };
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
    const postWritability = club.postWritability ?? PostWritability.CLUB_MEMBERS;
    let canWritePosts = false;

    const permissions = await checkClubPermission(session.user, club, client);
    if (postWritability === PostWritability.UNIV_MEMBERS) {
      canWritePosts = permissions.canJoin > 0;
    } else if (postWritability === PostWritability.CLUB_MEMBERS) {
      canWritePosts = !!permissions.role;
    } else if (postWritability === PostWritability.ADMIN_AND_MODS) {
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
      clubId: club.id,
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
    console.error('Error creating club post:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};
