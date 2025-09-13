import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Shop } from '$lib/types';
import { toPlainObject } from '$lib/utils';
import mongo from '$lib/db/index.server';
import { ShopSource } from '$lib/constants';

export const load: PageServerLoad = async ({ params, parent }) => {
  const { source, id } = params;

  // Validate source
  if (!Object.values(ShopSource).includes(source as ShopSource)) {
    error(404, 'Invalid shop source');
  }

  // Validate id
  const shopId = parseInt(id);
  if (isNaN(shopId)) {
    error(404, 'Invalid shop ID');
  }

  try {
    const db = mongo.db();
    const shopsCollection = db.collection<Shop>('shops');

    // Find the shop by source and id
    const shop = await shopsCollection.findOne({
      source: source as ShopSource,
      id: shopId
    });

    if (!shop) {
      error(404, 'Shop not found');
    }

    const { session } = await parent();

    return {
      shop: toPlainObject(shop),
      user: session?.user
    };
  } catch (err) {
    console.error('Error loading shop:', err);
    error(500, 'Failed to load shop');
  }
};
