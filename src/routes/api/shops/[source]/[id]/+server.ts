import { json, error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { Shop } from '$lib/types';
import { toPlainObject } from '$lib/utils';
import mongo from '$lib/db/index.server';
import { ShopSource } from '$lib/constants';
import type { RequestHandler } from './$types';
import { m } from '$lib/paraglide/messages';

export const GET: RequestHandler = async ({ params }) => {
  const { source, id } = params;

  // Validate source
  if (!Object.values(ShopSource).includes(source as ShopSource)) {
    error(404, m.invalid_shop_source());
  }

  // Validate id
  const shopId = parseInt(id);
  if (isNaN(shopId)) {
    error(404, m.invalid_shop_id());
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
      error(404, m.shop_not_found());
    }

    return json({
      shop: toPlainObject(shop)
    });
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error fetching shop:', err);
    error(500, m.failed_to_fetch_shop());
  }
};
