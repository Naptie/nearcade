import { json, error, isHttpError } from '@sveltejs/kit';
import type { Shop } from '$lib/types';
import { toPlainObject } from '$lib/utils';
import mongo from '$lib/db/index.server';
import { ShopSource } from '$lib/constants';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
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

    return json({
      shop: toPlainObject(shop)
    });
  } catch (err) {
    console.error('Error fetching shop:', err);
    if (err && isHttpError(err)) {
      throw err;
    }
    error(500, 'Failed to fetch shop');
  }
};
