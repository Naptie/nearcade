import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import client from '$lib/db.server';
import type { Post, PostVote, University, Club } from '$lib/types';
import { PostReadability } from '$lib/types';
import { nanoid } from 'nanoid';
import {
  checkUniversityPermission,
  checkClubPermission,
  getDefaultPostReadability
} from '$lib/utils';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  try {
    const session = await locals.auth();
    if (!session?.user?.id) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }

    const postId = params.postId;
    if (!postId) {
      return json({ error: 'Invalid post ID' }, { status: 400 });
    }

    const { voteType } = (await request.json()) as { voteType: 'upvote' | 'downvote' };
    if (!voteType || !['upvote', 'downvote'].includes(voteType)) {
      return json({ error: 'Invalid vote type' }, { status: 400 });
    }

    const db = client.db();
    const postsCollection = db.collection<Post>('posts');
    const votesCollection = db.collection<PostVote>('post_votes');

    // Check if post exists
    const post = await postsCollection.findOne({ id: postId });
    if (!post) {
      return json({ error: 'Post not found' }, { status: 404 });
    }

    // Check voting permissions based on post readability (anyone who can read posts can vote)
    let canVote = true;

    if (post.universityId) {
      const university = await db
        .collection<University>('universities')
        .findOne({ id: post.universityId });
      if (university) {
        const postReadability = getDefaultPostReadability(university.postReadability);
        if (postReadability === PostReadability.UNIV_MEMBERS) {
          const permissions = await checkUniversityPermission(session.user, university, client);
          canVote = !!permissions.role; // User is member if role is not empty
        }
      }
    } else if (post.clubId) {
      const club = await db.collection<Club>('clubs').findOne({ id: post.clubId });
      if (club) {
        const postReadability = getDefaultPostReadability(club.postReadability);
        if (
          postReadability === PostReadability.CLUB_MEMBERS ||
          postReadability === PostReadability.UNIV_MEMBERS
        ) {
          const permissions = await checkClubPermission(session.user, club, client);
          if (postReadability === PostReadability.CLUB_MEMBERS) {
            canVote = !!permissions.role;
          } else {
            canVote =
              !!permissions.role ||
              permissions.canJoin > 0 ||
              !!(await checkUniversityPermission(session.user, club.universityId, client)).role;
          }
        }
      }
    }

    if (!canVote) {
      return json({ error: 'Permission denied' }, { status: 403 });
    }

    // Check if post is locked and user has permission to interact
    if (post.isLocked) {
      let canInteract = false;

      if (post.universityId) {
        const university = await db
          .collection<University>('universities')
          .findOne({ id: post.universityId });
        if (university) {
          const permissions = await checkUniversityPermission(session.user, university, client);
          canInteract = permissions.canEdit;
        }
      } else if (post.clubId) {
        const club = await db.collection<Club>('clubs').findOne({ id: post.clubId });
        if (club) {
          const permissions = await checkClubPermission(session.user, club, client);
          canInteract = permissions.canEdit;
        }
      }

      if (!canInteract) {
        return json({ error: 'Post is locked' }, { status: 403 });
      }
    }

    // Check if user already voted
    const existingVote = await votesCollection.findOne({
      postId: postId,
      userId: session.user.id
    });

    let upvoteDelta = 0;
    let downvoteDelta = 0;

    if (existingVote) {
      // User already voted
      if (existingVote.voteType === voteType) {
        // Same vote - remove it (toggle off)
        await votesCollection.deleteOne({ _id: existingVote._id });

        if (voteType === 'upvote') {
          upvoteDelta = -1;
        } else {
          downvoteDelta = -1;
        }
      } else {
        // Different vote - change it
        await votesCollection.updateOne(
          { _id: existingVote._id },
          {
            $set: {
              voteType: voteType,
              updatedAt: new Date()
            }
          }
        );

        if (voteType === 'upvote') {
          upvoteDelta = 1;
          downvoteDelta = -1;
        } else {
          upvoteDelta = -1;
          downvoteDelta = 1;
        }
      }
    } else {
      // New vote
      const newVote: PostVote = {
        id: nanoid(),
        postId: postId,
        userId: session.user.id,
        voteType: voteType,
        createdAt: new Date()
      };

      await votesCollection.insertOne(newVote);

      if (voteType === 'upvote') {
        upvoteDelta = 1;
      } else {
        downvoteDelta = 1;
      }
    }

    // Update post vote counts
    await postsCollection.updateOne(
      { id: postId },
      {
        $inc: {
          upvotes: upvoteDelta,
          downvotes: downvoteDelta
        }
      }
    );

    // Get updated post data
    const updatedPost = await postsCollection.findOne({ id: postId });
    const currentUserVote = await votesCollection.findOne({
      postId: postId,
      userId: session.user.id
    });

    return json({
      success: true,
      upvotes: updatedPost?.upvotes || 0,
      downvotes: updatedPost?.downvotes || 0,
      userVote: currentUserVote ? currentUserVote.voteType : null
    });
  } catch (error) {
    console.error('Error voting on post:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};
