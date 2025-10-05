import type { PageServerLoad } from './$types';
import type { ClubMember, Shop, ShopWithAttendance } from '$lib/types';
import { toPlainArray } from '$lib/utils';
import mongo from '$lib/db/index.server';
import redis from '$lib/db/redis.server';
import { ShopSource } from '$lib/constants';
import { getShopsAttendanceData } from '$lib/endpoints/attendance.server';

const getShopAttendanceData = async (
  shops: Shop[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session?: { user?: any } | null
): Promise<ShopWithAttendance[]> => {
  try {
    if (!redis || shops.length === 0) {
      return shops.map((shop) => ({
        ...shop,
        totalAttendance: 0,
        currentReportedAttendance: null
      }));
    }

    // Use the new function to get attendance data for all shops at once
    const attendanceData = await getShopsAttendanceData(
      shops.map((shop) => ({ source: shop.source, id: shop.id })),
      { fetchRegistered: false, fetchReported: true, session }
    );

    return shops.map((shop) => {
      const shopIdentifier = `${shop.source}-${shop.id}`;
      const data = attendanceData.get(shopIdentifier);

      if (data && data.reported.length > 0) {
        const latestReport = data.reported[0];
        return {
          ...shop,
          totalAttendance: data.total || 0,
          currentReportedAttendance: latestReport
            ? {
                reportedAt: latestReport.reportedAt,
                reportedBy: latestReport.reporter!,
                comment: latestReport.comment ?? null
              }
            : null
        };
      } else {
        return {
          ...shop,
          totalAttendance: data?.total || 0,
          currentReportedAttendance: null
        };
      }
    });
  } catch (error) {
    console.error('Failed to get attendance data:', error);
    return shops.map((shop) => ({
      ...shop,
      totalAttendance: 0,
      currentReportedAttendance: null
    }));
  }
};

export const load: PageServerLoad = async ({ parent }) => {
  const { session } = await parent();

  if (!session || !session.user) {
    return {
      starredShops: [],
      joinedClubsStarredShops: []
    };
  }

  const user = session.user;

  try {
    const db = mongo.db();

    // Get user's current attendance from Redis
    let currentlyAttendingShop: ShopWithAttendance | null = null;
    if (redis) {
      try {
        // Get Redis keys for user's current attendance
        const userAttendanceKeys = await redis.keys(`nearcade:attend:*:${user.id}:*`);

        if (userAttendanceKeys.length > 0) {
          // Extract shop identifier from the first key
          // Key format: nearcade:attend:${source}-${id}:${userId}:${attendedAt}:${gameId},...
          const firstKey = userAttendanceKeys[0];
          const keyParts = firstKey.split(':');

          if (keyParts.length >= 3) {
            const shopIdentifier = keyParts[2]; // source-id format
            const [source, idStr] = shopIdentifier.split('-');
            const id = parseInt(idStr);

            if (source && !isNaN(id)) {
              // Fetch the shop data from MongoDB
              const shopData = await db.collection<Shop>('shops').findOne({
                source: source as ShopSource,
                id: id
              });

              if (shopData) {
                currentlyAttendingShop = {
                  ...shopData,
                  isInAttendance: true
                } as ShopWithAttendance;
              }
            }
          }
        }
      } catch (redisError) {
        console.error('Error getting user attendance from Redis:', redisError);
      }
    }

    // Get user's starred shops
    let starredShops: Shop[] = [];
    if (user.starredArcades && user.starredArcades.length > 0) {
      const starredShopsQuery = db
        .collection<Shop>('shops')
        .find({
          $or: user.starredArcades.map((shop) => ({
            $and: [{ source: shop.source }, { id: shop.id }]
          }))
        })
        .limit(20);

      starredShops = await starredShopsQuery.toArray();
    }

    // Get user's joined clubs
    const joinedClubs = await db
      .collection<ClubMember>('club_members')
      .aggregate([
        { $match: { userId: user.id } },
        {
          $lookup: {
            from: 'clubs',
            localField: 'clubId',
            foreignField: 'id',
            as: 'club'
          }
        },
        { $unwind: { path: '$club', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 0,
            clubId: 1,
            starredArcades: '$club.starredArcades'
          }
        }
      ])
      .toArray();

    let joinedClubsStarredShops: Shop[] = [];
    if (joinedClubs.length > 0) {
      const arcadesLists = joinedClubs
        .map((club) => club.starredArcades)
        .filter((arcades) => arcades && arcades.length > 0);

      if (arcadesLists.length > 0) {
        const clubStarredShopsQuery = db
          .collection<Shop>('shops')
          .find({
            $or: arcadesLists.flatMap((arcades) =>
              arcades.map((shop: { source: string; id: number }) => ({
                $and: [{ source: shop.source }, { id: shop.id }]
              }))
            )
          })
          .limit(20);

        joinedClubsStarredShops = await clubStarredShopsQuery.toArray();
      }
    }

    // Merge and deduplicate shops by "source-id" while preserving order
    // If user is currently attending a shop, add it first
    const seen = new Set<string>();
    const allShops: Shop[] = [];

    if (currentlyAttendingShop) {
      const currentKey = `${currentlyAttendingShop.source}-${currentlyAttendingShop.id}`;
      allShops.push(currentlyAttendingShop);
      seen.add(currentKey);
    }

    // Add starred shops and club starred shops
    for (const shop of [...starredShops, ...joinedClubsStarredShops]) {
      const key = `${shop.source}-${shop.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        allShops.push(shop);
      }
    }

    const shopsWithAttendance = await getShopAttendanceData(allShops, session);

    return {
      starredShops: toPlainArray(shopsWithAttendance)
    };
  } catch (error) {
    console.error('Failed to load starred shops:', error);
    return {
      starredShops: [],
      joinedClubsStarredShops: []
    };
  }
};
