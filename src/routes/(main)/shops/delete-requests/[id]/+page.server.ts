import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { ShopDeleteRequest } from '$lib/types';
import { toPlainObject } from '$lib/utils';
import mongo from '$lib/db/index.server';
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

  return {
    deleteRequest: toPlainObject(deleteRequest),
    user: session?.user
  };
};
