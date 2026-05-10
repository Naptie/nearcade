import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import {
  shopDeleteRequestsListQuerySchema,
  shopDeleteRequestsListResponseSchema
} from '$lib/schemas/shops';
import { parseQueryOrError } from '$lib/utils/validation.server';
import { toPlainArray } from '$lib/utils';

export const GET: RequestHandler = async ({ url }) => {
  const { status } = parseQueryOrError(shopDeleteRequestsListQuerySchema, url);
  const db = mongo.db();

  const query: Record<string, unknown> = {};
  if (status !== 'all') {
    query.status = status;
  }

  const requests = await db
    .collection('shop_delete_requests')
    .find(query)
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();

  const response = shopDeleteRequestsListResponseSchema.parse({
    requests: toPlainArray(requests),
    currentStatus: status
  });

  return json(response);
};
