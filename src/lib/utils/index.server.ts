import type { ShopSource } from '$lib/constants';
import mongo from '$lib/db/index.server';
import redis from '$lib/db/redis.server';
import type { Shop } from '$lib/types';

export const getCurrentAttendance = async (userId: string) => {
  const attendancePattern = `nearcade:attend:*:${userId}:*`;
  const db = mongo.db();
  const shopsCollection = db.collection<Shop>('shops');

  if (!redis.isOpen) {
    await redis.connect();
  }
  const keys = await redis.keys(attendancePattern);
  if (redis.isOpen) {
    redis.quit();
  }

  if (keys.length > 0) {
    const keyParts = keys[0].split(':');
    const [source, id] = keyParts[2].split('-');
    const attendedAt = new Date(decodeURIComponent(keyParts[4]));
    const visitingShop = await shopsCollection.findOne({
      source: source as ShopSource,
      id: parseInt(id)
    });
    if (visitingShop) {
      return { shop: visitingShop, attendedAt };
    }
  }
  return null;
};
