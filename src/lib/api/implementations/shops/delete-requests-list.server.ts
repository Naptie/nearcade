/**
 * Reading delete requests: the list of requests, and a single request with
 * the vote summary of the viewer.
 */

import mongo from '$lib/db/index.server';
import { hydrateEntitiesWithImages } from '$lib/images/index.server';
import { m } from '$lib/paraglide/messages';
import {
  shopDeleteRequestDetailResponseSchema,
  shopDeleteRequestsListResponseSchema
} from '$lib/schemas/shops';
import type { ShopDeleteRequest } from '$lib/types/index.server';
import { toPlainArray } from '$lib/utils';
import {
  attachDeleteRequestUsers,
  getShopDeleteRequestVoteSummary
} from '$lib/utils/shops/delete-request.server';
import { apiError } from '../../errors';
import { impl } from './delete-requests-shared.server';
import { toPlainWire } from './shared.server';

export const shopsDeleteRequestsListImplementation = {
  /** `GET /api/shops/delete-requests` */
  listDeleteRequests: impl.listDeleteRequests.handler(async ({ input }) => {
    const { status } = input;
    const db = mongo.db();

    const query: Record<string, unknown> = {};
    if (status !== 'all') {
      query.status = status;
    }

    const requests = await db
      .collection<ShopDeleteRequest>('shop_delete_requests')
      .find(query)
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    const hydrated = await hydrateEntitiesWithImages(db, requests);
    const hydratedWithUsers = await attachDeleteRequestUsers(db, hydrated);

    return toPlainWire(shopDeleteRequestsListResponseSchema, {
      requests: toPlainArray(hydratedWithUsers),
      currentStatus: status
    });
  }),

  /** `GET /api/shops/delete-requests/{id}` */
  getDeleteRequest: impl.getDeleteRequest.handler(async ({ input, context }) => {
    const { id } = input;
    const db = mongo.db();
    const deleteRequestsCollection = db.collection<ShopDeleteRequest>('shop_delete_requests');

    const deleteRequest = await deleteRequestsCollection.findOne({ id });
    if (!deleteRequest) {
      apiError('NOT_FOUND', m.shop_delete_request_not_found());
    }

    const [hydratedDeleteRequest] = await hydrateEntitiesWithImages(db, [deleteRequest]);
    const [deleteRequestWithUsers] = await attachDeleteRequestUsers(db, [hydratedDeleteRequest]);
    const voteSummary = await getShopDeleteRequestVoteSummary(
      db,
      deleteRequestWithUsers.id,
      context.session?.user?.id
    );

    return toPlainWire(shopDeleteRequestDetailResponseSchema, {
      deleteRequest: deleteRequestWithUsers,
      voteSummary
    });
  })
};
