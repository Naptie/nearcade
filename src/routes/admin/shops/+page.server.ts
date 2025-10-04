import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Shop } from '$lib/types';
import { toPlainArray } from '$lib/utils';
import mongo from '$lib/db/index.server';

export const load: PageServerLoad = async ({ locals, url }) => {
  const session = await locals.auth();

  if (!session?.user) {
    error(401, 'Authentication required');
  }

  // Only site admins can manage arcade shops
  if (session.user.userType !== 'site_admin') {
    error(403, 'Access denied');
  }

  const search = url.searchParams.get('search') || '';
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = 20;
  const skip = (page - 1) * limit;

  const db = mongo.db();

  // Build search query
  const searchQuery: Record<string, unknown> = {};
  if (search.trim()) {
    searchQuery.$or = [{ name: { $regex: search.trim(), $options: 'i' } }];
  }

  // Fetch shops with game counts
  const shops = (await db
    .collection<Shop>('shops')
    .aggregate(
      [
        { $match: searchQuery },
        {
          $addFields: {
            gamesCount: { $size: { $ifNull: ['$games', []] } }
          }
        },
        { $sort: { name: 1 } },
        { $skip: skip },
        { $limit: limit + 1 } // Fetch one extra to check if there are more
      ],
      {
        collation: { locale: 'zh@collation=gb2312han' }
      }
    )
    .toArray()) as Array<
    Shop & {
      gamesCount: number;
    }
  >;

  const hasMore = shops.length > limit;
  if (hasMore) {
    shops.pop(); // Remove the extra item
  }

  // Get shop statistics
  const totalShops = await db.collection('shops').countDocuments();

  return {
    shops: toPlainArray(shops),
    search,
    currentPage: page,
    hasMore,
    shopStats: {
      total: totalShops
    }
  };
};
