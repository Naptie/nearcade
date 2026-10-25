/**
 * Voting on a post.
 *
 * A vote is an interaction, so it needs both of the permissions a post
 * interaction needs: the caller has to be able to read the post, and a locked
 * post only accepts votes from the people who manage its organisation.
 */
import { nanoid } from 'nanoid';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { notify } from '$lib/notifications/index.server';
import { postVoteResponseSchema } from '$lib/schemas/posts';
import type { Post, PostVote } from '$lib/types/index.server';
import { resolvePostAccess } from '$lib/utils/posts/permissions.server';
import { apiError, rethrowApiError, toWire } from '../../errors';
import { assertPostAccess, impl } from './shared.server';

export const postsVoteImplementation = {
  /** `POST /api/posts/{postId}/vote` */
  vote: impl.vote.handler(async ({ input, context }) => {
    const session = context.session;
    if (!session?.user?.id) {
      apiError('UNAUTHORIZED', m.unauthorized());
    }

    const { postId, voteType } = input;

    try {
      const db = mongo.db();
      const postsCollection = db.collection<Post>('posts');
      const votesCollection = db.collection<PostVote>('post_votes');

      // Check if post exists
      const post = await postsCollection.findOne({ id: postId });
      if (!post) {
        apiError('NOT_FOUND', m.post_not_found());
      }

      // Check if user can read the post, and whether a locked post still lets
      // the caller interact with it.
      const access = await resolvePostAccess({
        post,
        viewer: session?.user,
        db,
        client: mongo,
        gates: ['read', 'lock']
      });
      assertPostAccess(access);

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

      return toWire(postVoteResponseSchema, {
        success: true,
        upvotes: updatedPost?.upvotes || 0,
        downvotes: updatedPost?.downvotes || 0,
        userVote: currentUserVote ? currentUserVote.voteType : null
      });
    } catch (err) {
      rethrowApiError(err, m.internal_server_error());
    }
  })
};
