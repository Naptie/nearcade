import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import client from '$lib/db.server';
import {
  PostReadability,
  type Club,
  type Comment,
  type CommentVote,
  type University
} from '$lib/types';
import { nanoid } from 'nanoid';
import { getDefaultPostReadability } from '$lib/utils';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  try {
    const session = await locals.auth();
    if (!session?.user?.id) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }

    const commentId = params.commentId;
    if (!commentId) {
      return json({ error: 'Invalid comment ID' }, { status: 400 });
    }

    const { voteType } = (await request.json()) as {
      voteType: 'upvote' | 'downvote';
    };
    if (!voteType || !['upvote', 'downvote'].includes(voteType)) {
      return json({ error: 'Invalid vote type' }, { status: 400 });
    }

    const db = client.db();
    const commentsCollection = db.collection<Comment>('comments');
    const votesCollection = db.collection<CommentVote>('comment_votes');

    // Check if comment exists
    const comment = await commentsCollection.findOne({ id: commentId });
    if (!comment) {
      return json({ error: 'Comment not found' }, { status: 404 });
    }

    // Get the post to check permissions
    const postsCollection = db.collection('posts');
    const post = await postsCollection.findOne({ id: comment.postId });
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
          const { checkUniversityPermission } = await import('$lib/utils');
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
          const { checkClubPermission } = await import('$lib/utils');
          const permissions = await checkClubPermission(session.user, club, client, true);
          if (postReadability === PostReadability.CLUB_MEMBERS) {
            canVote = !!permissions.role;
          } else {
            canVote = !!permissions.role || permissions.canJoin > 0;
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
          const { checkUniversityPermission } = await import('$lib/utils');
          const permissions = await checkUniversityPermission(session.user, university, client);
          canInteract = permissions.canEdit;
        }
      } else if (post.clubId) {
        const club = await db.collection<Club>('clubs').findOne({ id: post.clubId });
        if (club) {
          const { checkClubPermission } = await import('$lib/utils');
          const permissions = await checkClubPermission(session.user, club, client);
          canInteract = permissions.canEdit;
        }
      }

      if (!canInteract) {
        return json({ error: 'Post is locked' }, { status: 403 });
      }
    }

    // Check for existing vote
    const existingVote = await votesCollection.findOne({
      commentId: commentId,
      userId: session.user.id
    });

    const userId = session.user.id;
    let upvoteDelta = 0;
    let downvoteDelta = 0;
    let newUserVote: 'upvote' | 'downvote' | null = null;

    if (existingVote) {
      if (existingVote.voteType === voteType) {
        // Remove vote (toggle off)
        await votesCollection.deleteOne({
          commentId: commentId,
          userId: userId
        });

        if (voteType === 'upvote') {
          upvoteDelta = -1;
        } else {
          downvoteDelta = -1;
        }
        newUserVote = null;
      } else {
        // Change vote type
        await votesCollection.updateOne(
          {
            commentId: commentId,
            userId: userId
          },
          {
            $set: {
              voteType: voteType,
              createdAt: new Date()
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
        newUserVote = voteType;
      }
    } else {
      // Create new vote
      const newVote: CommentVote = {
        id: nanoid(),
        commentId: commentId,
        userId: userId,
        voteType: voteType,
        createdAt: new Date()
      };

      await votesCollection.insertOne(newVote);

      if (voteType === 'upvote') {
        upvoteDelta = 1;
      } else {
        downvoteDelta = 1;
      }
      newUserVote = voteType;
    }

    // Update comment vote counts
    await commentsCollection.updateOne(
      { id: commentId },
      {
        $inc: {
          upvotes: upvoteDelta,
          downvotes: downvoteDelta
        }
      }
    );

    // Get updated vote counts
    const updatedComment = await commentsCollection.findOne({ id: commentId });
    if (!updatedComment) {
      return json({ error: 'Failed to get updated comment' }, { status: 500 });
    }

    return json({
      success: true,
      upvotes: updatedComment.upvotes,
      downvotes: updatedComment.downvotes,
      userVote: newUserVote
    });
  } catch (error) {
    console.error('Error voting on comment:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};
