import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import type { Shop } from '$lib/types';
import { toPlainArray } from '$lib/utils';
import { PAGINATION } from '$lib/constants';

export const GET: RequestHandler = async ({ url }) => {
  const query = url.searchParams.get('q');
  const limit = parseInt(url.searchParams.get('limit') || '0') || PAGINATION.PAGE_SIZE;

  if (!query || query.trim().length === 0) {
    return json({ shops: [] });
  }

  try {
    const db = mongo.db();
    const shopsCollection = db.collection<Shop>('shops');

    let shops;
    try {
      // Try Atlas Search first
      shops = await shopsCollection
        .aggregate([
          {
            $search: {
              index: 'default',
              text: {
                query: query.trim(),
                path: 'name',
                score: { boost: { value: 2 } }
              }
            }
          },
          {
            $limit: limit
          }
        ])
        .toArray();
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        err.code !== 6047401 // SearchNotEnabled
      ) {
        throw err;
      }
      // Fallback to regex search
      shops = await shopsCollection
        .find({
          name: {
            $regex: query.trim(),
            $options: 'i'
          }
        })
        .limit(limit)
        .toArray();
    }

    return json({
      shops: toPlainArray(shops)
    });
  } catch (error) {
    console.error('Error searching shops:', error);
    return json({ shops: [] }, { status: 500 });
  }
};
