import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Shop, ShopPhoto } from '$lib/types';
import { toPlainObject, toPlainArray } from '$lib/utils';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';

export const load: PageServerLoad = async ({ params, parent }) => {
  const { session } = await parent();
  const shopId = parseInt(params.id);
  if (isNaN(shopId)) {
    error(404, m.invalid_shop_id());
  }

  const db = mongo.db();
  const shop = await db.collection<Shop>('shops').findOne({ id: shopId });
  if (!shop) {
    error(404, m.shop_not_found());
  }

  const photos = await db
    .collection<ShopPhoto>('shop_photos')
    .find({ shopId })
    .sort({ uploadedAt: -1 })
    .toArray();

  return {
    shop: toPlainObject(shop),
    photos: toPlainArray(photos),
    user: session?.user
  };
};
