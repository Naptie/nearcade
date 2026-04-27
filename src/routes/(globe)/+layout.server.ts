import mongo from '$lib/db/index.server';
import { getAllShopsAttendanceData } from '$lib/endpoints/attendance.server';
import type { Shop } from '$lib/types';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ depends }) => {
  depends('app:globe-shops');
  const db = mongo.db();

  return {
    globeShopData: db
      .collection<Shop>('shops')
      .find({})
      .project({
        _id: 0,
        name: 1,
        address: 1,
        location: 1,
        openingHours: 1,
        games: 1,
        source: 1,
        id: 1
      })
      .toArray() as Promise<Shop[]>,
    globeAttendanceData: getAllShopsAttendanceData()
  };
};
