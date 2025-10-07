import { json, error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import { type Club, type Comment, type CommentVote, type University } from '$lib/types';
import { nanoid } from 'nanoid';
import { canReadPost } from '$lib/utils';
import { notify } from '$lib/notifications/index.server';
import { m } from '$lib/paraglide/messages';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  try {
    const session = await locals.auth();
    if (!session?.user?.id) {
      error(401, m.unauthorized());
    }

    const commentId = params.commentId;
    if (!commentId) {
      error(400, m.error_invalid_comment_id());
    }

    const { voteType } = (await request.json()) as {
      voteType: 'upvote' | 'downvote';
    };
    if (!voteType || !['upvote', 'downvote'].includes(voteType)) {
      error(400, m.error_invalid_vote_type());
    }

    const db = mongo.db();
    const commentsCollection = db.collection<Comment>('comments');
    const votesCollection = db.collection<CommentVote>('comment_votes');

    // Check if comment exists
    const comment = await commentsCollection.findOne({ id: commentId });
    if (!comment) {
      error(404, m.error_comment_not_found());
    }

    // Get the post to check permissions
    const postsCollection = db.collection('posts');
    const post = await postsCollection.findOne({ id: comment.postId });
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
          const { checkUniversityPermission } = await import('$lib/utils');
          const permissions = await checkUniversityPermission(session.user, university, mongo);
          canInteract = permissions.canEdit;
        }
      } else if (post.clubId) {
        const club = await db.collection<Club>('clubs').findOne({ id: post.clubId });
        if (club) {
          const { checkClubPermission } = await import('$lib/utils');
          const permissions = await checkClubPermission(session.user, club, mongo);
          canInteract = permissions.canEdit;
        }
      }

      if (!canInteract) {
        error(403, m.error_post_is_locked());
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

      // Send notification for new comment votes
      try {
        if (comment.createdBy !== session.user.id) {
          await notify({
            type: 'COMMENT_VOTES',
            actorUserId: session.user.id,
            actorName: session.user.name || '',
            actorDisplayName: session.user.displayName || undefined,
            actorImage: session.user.image || undefined,
            targetUserId: comment.createdBy,
            content: comment.content.substring(0, 200),
            postId: comment.postId,
            postTitle: post?.title,
            commentId: comment.id,
            voteType: voteType,
            universityId: post?.universityId,
            clubId: post?.clubId
          });
        }
      } catch (notificationError) {
        // Don't fail the vote if notification fails
        console.error('Failed to send comment vote notification:', notificationError);
      }
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
      error(500, m.error_failed_to_get_updated_comment());
    }

    return json({
      success: true,
      upvotes: updatedComment.upvotes,
      downvotes: updatedComment.downvotes,
      userVote: newUserVote
    });
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error voting on comment:', err);
    error(500, m.error_internal_server_error());
  }
};
