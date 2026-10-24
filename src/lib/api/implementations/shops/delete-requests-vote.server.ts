/**
 * The favour/against vote on a delete request.
 */

import { nanoid } from 'nanoid';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { requireBoundPhone } from '$lib/utils/index.server';
import { getShopDeleteRequestVoteSummary } from '$lib/utils/shops/delete-request.server';
import { apiError, rethrowApiError } from '../../errors';
import { impl } from './delete-requests-shared.server';

export const shopsDeleteRequestsVoteImplementation = {
  /** `POST /api/shops/delete-requests/{id}/vote` */
  voteDeleteRequest: impl.voteDeleteRequest.handler(async ({ input, context }) => {
    try {
      // `guard: 'session'` on the contract already rejected an unauthenticated
      // request, so the session is present by construction.
      const session = context.session!;

      requireBoundPhone(session.user);

      const { id } = input;
      const { voteType } = input;

      const db = mongo.db();
      const deleteRequestsCollection = db.collection('shop_delete_requests');
      const votesCollection = db.collection('shop_delete_request_votes');

      const deleteRequest = await deleteRequestsCollection.findOne({ id });
      if (!deleteRequest) {
        apiError('NOT_FOUND', m.shop_delete_request_not_found());
      }

      if (deleteRequest.status !== 'pending') {
        apiError('CONFLICT', 'This delete request is closed');
      }

      const existingVote = await votesCollection.findOne({
        shopDeleteRequestId: deleteRequest.id,
        userId: session.user.id
      });

      if (existingVote) {
        if (existingVote.voteType === voteType) {
          await votesCollection.deleteOne({ _id: existingVote._id });
        } else {
          await votesCollection.updateOne(
            { _id: existingVote._id },
            {
              $set: {
                voteType,
                updatedAt: new Date()
              }
            }
          );
        }
      } else {
        await votesCollection.insertOne({
          id: nanoid(),
          shopDeleteRequestId: deleteRequest.id,
          userId: session.user.id,
          voteType,
          createdAt: new Date()
        });
      }

      const summary = await getShopDeleteRequestVoteSummary(db, deleteRequest.id, session.user.id);

      return {
        success: true,
        ...summary
      };
    } catch (err) {
      rethrowApiError(err);
    }
  })
};
