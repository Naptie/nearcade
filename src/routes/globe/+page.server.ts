import mongo from '$lib/db/index.server';
import { getAllShopsAttendanceData } from '$lib/endpoints/attendance.server';
import type { Shop } from '$lib/types';
import type { PageServerLoad } from './$types';

export const ssr = false;

export const load: PageServerLoad = async () => {
  const db = mongo.db();

  const shops = (await db
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
    .toArray()) as Shop[];

  const attendanceData = await getAllShopsAttendanceData();

  return {
    shops: shops.map((shop) => ({
      ...shop,
      attendances: attendanceData.get(`${shop.source}-${shop.id}`) || []
    }))
  };
};
