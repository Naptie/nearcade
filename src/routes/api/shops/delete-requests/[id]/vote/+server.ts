import { json, error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { nanoid } from 'nanoid';
import mongo from '$lib/db/index.server';
import type { ShopDeleteRequest, ShopDeleteRequestVote } from '$lib/types';
import { getShopDeleteRequestVoteSummary } from '$lib/utils/shops/delete-request.server';
import { m } from '$lib/paraglide/messages';
import { shopDeleteRequestVoteSchema } from '$lib/schemas/content';
import { validationMessage } from '$lib/schemas/common';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  try {
    const session = locals.session;
    if (!session?.user?.id) {
      error(401, m.unauthorized());
    }

    const rawBody = await request.json().catch(() => null);
    if (rawBody === null) {
      error(400, 'Invalid request body');
    }

    const parsedBody = shopDeleteRequestVoteSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      error(400, validationMessage(parsedBody.error.issues, m.invalid_vote_type()));
    }

    const { voteType } = parsedBody.data;

    const db = mongo.db();
    const deleteRequestsCollection = db.collection<ShopDeleteRequest>('shop_delete_requests');
    const votesCollection = db.collection<ShopDeleteRequestVote>('shop_delete_request_votes');

    const deleteRequest = await deleteRequestsCollection.findOne({ id: params.id });
    if (!deleteRequest) {
      error(404, m.shop_delete_request_not_found());
    }

    if (deleteRequest.status !== 'pending') {
      error(409, 'This delete request is closed');
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

    return json({ success: true, ...summary });
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error voting on delete request:', err);
    error(500, m.internal_server_error());
  }
};
