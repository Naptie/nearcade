import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { ShopDeleteRequest } from '$lib/types';
import { toPlainArray, toPlainObject } from '$lib/utils';
import mongo from '$lib/db/index.server';
import { hydrateEntitiesWithImages } from '$lib/images/index.server';
import {
  getShopDeleteRequestComments,
  getShopDeleteRequestVoteSummary
} from '$lib/utils/shops/delete-request.server';
import { m } from '$lib/paraglide/messages';

export const load: PageServerLoad = async ({ params, parent }) => {
  const { session } = await parent();
  const { id } = params;

  const db = mongo.db();
  const deleteRequest = await db
    .collection<ShopDeleteRequest>('shop_delete_requests')
    .findOne({ id });

  if (!deleteRequest) {
    error(404, m.shop_delete_request_not_found());
  }

  const [hydratedDeleteRequest] = await hydrateEntitiesWithImages(db, [deleteRequest]);

  const [comments, voteSummary] = await Promise.all([
    getShopDeleteRequestComments(db, hydratedDeleteRequest.id, session?.user?.id),
    getShopDeleteRequestVoteSummary(db, hydratedDeleteRequest.id, session?.user?.id)
  ]);

  return {
    deleteRequest: toPlainObject(hydratedDeleteRequest),
    comments: toPlainArray(comments),
    voteSummary,
    user: session?.user
  };
};
