import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Shop } from '$lib/types';
import { PAGINATION } from '$lib/constants';
import { toPlainArray } from '$lib/utils';
import mongo from '$lib/db/index.server';
import redis from '$lib/db/redis.server';

async function getShopAttendanceCounts(shops: Shop[]) {
  if (!redis) {
    // If Redis is not available, return empty attendance data
    return shops.map((shop) => ({ ...shop, currentAttendance: 0 }));
  }

  try {
    // Get all attendance keys
    const allKeys = await redis.keys('nearcade:attend:*');

    // Create a map to store attendance counts per shop
    const attendanceMap = new Map<string, number>();

    // Count unique users per shop
    for (const key of allKeys) {
      // Key format: nearcade:attend:${source}-${id}:${userId}:${attendedAt}:${gameId}-${gameVersion},...
      const keyParts = key.split(':');
      if (keyParts.length === 6) {
        const shopIdentifier = keyParts[2]; // source-id
        const count = attendanceMap.get(shopIdentifier) || 0;
        attendanceMap.set(shopIdentifier, count + 1);
      }
    }

    // Add attendance count to each shop
    return shops.map((shop) => {
      const shopIdentifier = `${shop.source}-${shop.id}`;
      const currentAttendance = attendanceMap.get(shopIdentifier) || 0;
      return { ...shop, currentAttendance };
    });
  } catch (err) {
    console.error('Error getting attendance counts:', err);
    // Return shops with zero attendance on error
    return shops.map((shop) => ({ ...shop, currentAttendance: 0 }));
  }
}

export const load: PageServerLoad = async ({ url, parent }) => {
  const query = url.searchParams.get('q') || '';
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = PAGINATION.PAGE_SIZE;
  const skip = (page - 1) * limit;

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
                        path: 'generalAddress'
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
            { generalAddress: { $elemMatch: { $regex: query, $options: 'i' } } }
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

    // Get real-time attendance data for all shops
    const shopsWithAttendance = await getShopAttendanceCounts(shops);

    const { session } = await parent();

    return {
      shops: toPlainArray(shopsWithAttendance),
      totalCount,
      currentPage: page,
      hasNextPage: skip + shops.length < totalCount,
      hasPrevPage: page > 1,
      query,
      user: session?.user
    };
  } catch (err) {
    console.error('Error loading shops:', err);
    error(500, 'Failed to load shops');
  }
};
