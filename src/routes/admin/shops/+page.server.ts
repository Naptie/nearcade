import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { Shop } from '$lib/types';
import { toPlainArray } from '$lib/utils';
import client from '$lib/db.server';

export const load: PageServerLoad = async ({ locals, url }) => {
  const session = await locals.auth();

  if (!session?.user) {
    return fail(401, { error: 'Unauthorized' });
  }

  // Only site admins can manage arcade shops
  if (session.user.userType !== 'site_admin') {
    return fail(403, { error: 'Access denied' });
  }

  const search = url.searchParams.get('search') || '';
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = 20;
  const skip = (page - 1) * limit;

  const db = client.db();

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

export const actions: Actions = {
  delete: async ({ request, locals }) => {
    const session = await locals.auth();

    if (!session?.user) {
      return fail(401, { error: 'Unauthorized' });
    }

    // Only site admins can delete shops
    if (session.user.userType !== 'site_admin') {
      return fail(403, { error: 'Access denied' });
    }

    const formData = await request.formData();
    const shopId = formData.get('shopId') as string;

    if (!shopId) {
      return fail(400, { error: 'Shop ID is required' });
    }

    try {
      const db = client.db();

      // Check if shop exists
      const shop = await db.collection('shops').findOne({ id: parseInt(shopId) });
      if (!shop) {
        return fail(404, { error: 'Shop not found' });
      }

      // Delete the shop
      await db.collection('shops').deleteOne({ id: parseInt(shopId) });

      return { success: true };
    } catch (error) {
      console.error('Error deleting shop:', error);
      return fail(500, { error: 'Failed to delete shop' });
    }
  }
};
