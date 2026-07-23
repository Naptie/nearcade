import type { Db } from 'mongodb';

const SHOP_ID_COUNTER = 'shop_id';

interface ShopIdCounter {
  _id: string;
  seq: number;
}

export const getNextShopId = async (db: Db): Promise<number> => {
  const counters = db.collection<ShopIdCounter>('counters');
  const shops = db.collection('shops');
  const deletedShops = db.collection('deleted_shops');

  while (true) {
    const result = await counters.findOneAndUpdate(
      { _id: SHOP_ID_COUNTER },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after' }
    );

    const candidate = result!.seq;

    const [inShops, inDeleted] = await Promise.all([
      shops.findOne({ id: candidate }, { projection: { _id: 1 } }),
      deletedShops.findOne({ id: candidate }, { projection: { _id: 1 } })
    ]);

    if (!inShops && !inDeleted) {
      return candidate;
    }
  }
};
