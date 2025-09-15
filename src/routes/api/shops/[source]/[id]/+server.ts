import { json } from '@sveltejs/kit';
import type { Shop } from '$lib/types';
import { toPlainObject } from '$lib/utils';
import mongo from '$lib/db/index.server';
import { ShopSource } from '$lib/constants';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  const { source, id } = params;

  // Validate source
  if (!Object.values(ShopSource).includes(source as ShopSource)) {
    return json({ error: 'Invalid shop source' }, { status: 404 });
  }

  // Validate id
  const shopId = parseInt(id);
  if (isNaN(shopId)) {
    return json({ error: 'Invalid shop ID' }, { status: 404 });
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
      return json({ error: 'Shop not found' }, { status: 404 });
    }

    return json({
      shop: toPlainObject(shop)
    });
  } catch (err) {
    console.error('Error fetching shop:', err);
    return json({ error: 'Failed to fetch shop' }, { status: 500 });
  }
};
