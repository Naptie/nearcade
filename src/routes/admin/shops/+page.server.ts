import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Shop } from '$lib/types';
import { toPlainArray } from '$lib/utils';
import mongo from '$lib/db/index.server';
import { expandShopsRegions } from '$lib/utils/region.server';
import { parsePageParam } from '$lib/admin/list-state';
import { m } from '$lib/paraglide/messages';

export const load: PageServerLoad = async ({ locals, url }) => {
  const session = locals.session;

  if (!session?.user) {
    error(401, m.unauthorized());
  }

  // Only site admins can manage arcade shops
  if (session.user.userType !== 'site_admin') {
    error(403, m.access_denied());
  }

  const search = url.searchParams.get('search') || '';
  const page = parsePageParam(url);
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

  const db2 = db;
  const [totalShops, matchedShops] = await Promise.all([
    db2.collection('shops').countDocuments(),
    db2.collection('shops').countDocuments(searchQuery)
  ]);

  const shopsWithRegions = await expandShopsRegions(shops);

  return {
    shops: toPlainArray(shopsWithRegions),
    search,
    currentPage: page,
    hasMore,
    pageSize: limit,
    totalCount: matchedShops,
    shopStats: {
      total: totalShops
    }
  };
};
