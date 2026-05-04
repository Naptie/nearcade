import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Shop } from '$lib/types';
import { toPlainObject } from '$lib/utils';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';

export const load: PageServerLoad = async ({ params }) => {
  const { id } = params;

  const shopId = parseInt(id);
  if (isNaN(shopId)) {
    error(404, m.invalid_shop_id());
  }

  const db = mongo.db();
  const shop = await db.collection<Shop>('shops').findOne({
    id: shopId
  });

  if (!shop) {
    error(404, m.shop_not_found());
  }

  return { shop: toPlainObject(shop) };
};
