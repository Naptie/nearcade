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
    .collection<ShopPhoto>('images')
    .aggregate<ShopPhoto>([
      { $match: { shopId } },
      { $sort: { uploadedAt: -1 } },
      {
        $lookup: {
          from: 'users',
          let: { uid: '$uploadedBy' },
          pipeline: [
            { $match: { $expr: { $eq: ['$id', '$$uid'] } } },
            { $project: { _id: 0, id: 1, name: 1, displayName: 1, image: 1 } }
          ],
          as: 'uploaderArr'
        }
      },
      { $addFields: { uploader: { $arrayElemAt: ['$uploaderArr', 0] } } },
      { $project: { uploaderArr: 0 } }
    ])
    .toArray();

  return {
    shop: toPlainObject(shop),
    photos: toPlainArray(photos) as unknown as ShopPhoto[],
    user: session?.user
  };
};
