import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import type { Shop } from '$lib/types';
import { toPlainArray } from '$lib/utils';
import { PAGINATION } from '$lib/constants';

export const GET: RequestHandler = async ({ url }) => {
  const query = url.searchParams.get('q') || '';
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = parseInt(url.searchParams.get('limit') || '0') || PAGINATION.PAGE_SIZE;
  const skip = (page - 1) * limit;

  if (!query || query.trim().length === 0) {
    return json({ shops: [] });
  }

  try {
    const db = mongo.db();
    const shopsCollection = db.collection<Shop>('shops');

    let shops: Shop[];
    let totalCount: number;
    if (query.trim().length === 0) {
      // Load all shops with pagination
      totalCount = await shopsCollection.countDocuments();
      shops = (await shopsCollection
        .find({})
        .sort({ name: 1 })
        .collation({ locale: 'zh@collation=gb2312han' })
        .skip(skip)
        .limit(limit)
        .toArray()) as unknown as Shop[];
    } else {
      // Search shops
      let searchResults: Shop[];

      try {
        // Try Atlas Search first
        searchResults = (await shopsCollection
          .aggregate([
            {
              $search: {
                index: 'default',
                compound: {
                  should: [
                    {
                      text: {
                        query: query,
                        path: 'name',
                        score: { boost: { value: 2 } }
                      }
                    },
                    {
                      text: {
                        query: query,
                        path: 'address.general'
                      }
                    },
                    {
                      text: {
                        query: query,
                        path: 'address.detailed'
                      }
                    }
                  ]
                }
              }
            },
            { $sort: { score: { $meta: 'searchScore' }, name: 1 } },
            { $skip: skip },
            { $limit: limit }
          ])
          .toArray()) as unknown as Shop[];
      } catch {
        // Fallback to regex search
        const searchQuery = {
          $or: [
            { name: { $regex: query, $options: 'i' } },
            { 'address.general': { $elemMatch: { $regex: query, $options: 'i' } } },
            { 'address.detailed': { $regex: query, $options: 'i' } }
          ]
        };

        totalCount = await shopsCollection.countDocuments(searchQuery);
        searchResults = (await shopsCollection
          .find(searchQuery)
          .sort({ name: 1 })
          .collation({ locale: 'zh@collation=gb2312han' })
          .skip(skip)
          .limit(limit)
          .toArray()) as unknown as Shop[];
      }

      shops = searchResults;
      if (!totalCount!) {
        totalCount = shops.length + (shops.length === limit ? 1 : 0);
      }
    }

    return json({
      shops: toPlainArray(shops),
      totalCount,
      currentPage: page,
      hasNextPage: skip + shops.length < totalCount,
      hasPrevPage: page > 1
    });
  } catch (error) {
    console.error('Error searching shops:', error);
    return json({ shops: [] }, { status: 500 });
  }
};
