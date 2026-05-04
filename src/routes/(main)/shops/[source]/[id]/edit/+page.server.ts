import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Shop } from '$lib/types';
import { toPlainObject } from '$lib/utils';
import mongo from '$lib/db/index.server';
import { ShopSource } from '$lib/constants';
import { m } from '$lib/paraglide/messages';

export const load: PageServerLoad = async ({ params }) => {
  const { source: sourceRaw, id } = params;
  const source = sourceRaw.toLowerCase().trim();

  if (source !== ShopSource.NEARCADE) {
    error(400, 'Only nearcade shops can be edited');
  }

  const shopId = parseInt(id);
  if (isNaN(shopId)) {
    error(404, m.invalid_shop_id());
  }

  const db = mongo.db();
  const shop = await db.collection<Shop>('shops').findOne({
    source: ShopSource.NEARCADE,
    id: shopId
  });

  if (!shop) {
    error(404, m.shop_not_found());
  }

  return { shop: toPlainObject(shop) };
};
