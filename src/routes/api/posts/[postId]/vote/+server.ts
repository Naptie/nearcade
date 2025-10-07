import { json, error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import type { Post, PostVote, University, Club } from '$lib/types';
import { nanoid } from 'nanoid';
import { checkUniversityPermission, checkClubPermission, canReadPost } from '$lib/utils';
import { notify } from '$lib/notifications/index.server';
import { m } from '$lib/paraglide/messages';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  try {
    const session = await locals.auth();
    if (!session?.user?.id) {
      error(401, m.unauthorized());
    }

    const postId = params.postId;
    if (!postId) {
      error(400, m.error_invalid_post_id());
    }

    const { voteType } = (await request.json()) as { voteType: 'upvote' | 'downvote' };
    if (!voteType || !['upvote', 'downvote'].includes(voteType)) {
      error(400, m.error_invalid_vote_type());
    }

    const db = mongo.db();
    const postsCollection = db.collection<Post>('posts');
    const votesCollection = db.collection<PostVote>('post_votes');

    // Check if post exists
    const post = await postsCollection.findOne({ id: postId });
    if (!post) {
      error(404, m.error_post_not_found());
    }

    const canRead = await canReadPost(
      post.readability,
      { universityId: post.universityId, clubId: post.clubId },
      session?.user,
      mongo
    );

    if (!canRead) {
      error(403, m.permission_denied());
    }

    // Check if post is locked and user has permission to interact
    if (post.isLocked) {
      let canInteract = false;

      if (post.universityId) {
        const university = await db
          .collection<University>('universities')
          .findOne({ id: post.universityId });
        if (university) {
          const permissions = await checkUniversityPermission(session.user, university, mongo);
          canInteract = permissions.canEdit;
        }
      } else if (post.clubId) {
        const club = await db.collection<Club>('clubs').findOne({ id: post.clubId });
        if (club) {
          const permissions = await checkClubPermission(session.user, club, mongo);
          canInteract = permissions.canEdit;
        }
      }

      if (!canInteract) {
        error(403, m.error_post_is_locked());
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

    // Send notification for new votes (only notify post author)
    try {
      if (post.createdBy !== session.user.id) {
        await notify({
          type: 'POST_VOTES',
          actorUserId: session.user.id,
          actorName: session.user.name || '',
          actorDisplayName: session.user.displayName || undefined,
          actorImage: session.user.image || undefined,
          targetUserId: post.createdBy,
          postId: post.id,
          postTitle: post.title,
          voteType: voteType,
          universityId: post.universityId,
          clubId: post.clubId
        });
      }
    } catch (notificationError) {
      // Don't fail the vote if notification fails
      console.error('Failed to send vote notification:', notificationError);
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
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error voting on post:', err);
    error(500, m.error_internal_server_error());
  }
};
