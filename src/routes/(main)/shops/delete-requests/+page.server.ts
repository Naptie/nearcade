import type { PageServerLoad } from './$types';
import type { ShopDeleteRequest } from '$lib/types';
import { toPlainArray } from '$lib/utils';
import mongo from '$lib/db/index.server';
import { attachDeleteRequestRequesters } from '$lib/utils/shops/delete-request.server';

export const load: PageServerLoad = async ({ url, parent }) => {
  const { session } = await parent();
  const status = url.searchParams.get('status') || 'pending';
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

  const requestsWithRequesters = await attachDeleteRequestRequesters(db, requests);

  return {
    requests: toPlainArray(requestsWithRequesters),
    currentStatus: status,
    user: session?.user
  };
};
