import type { PageServerLoad } from './$types';
import type { Shop } from '$lib/types';
import { toPlainArray } from '$lib/utils';
import mongo from '$lib/db/index.server';
import redis from '$lib/db/redis.server';
import type { User } from '@auth/sveltekit';

const getShopAttendanceData = async (shops: Shop[]) => {
  if (!redis) {
    // If Redis is not available, return empty attendance data
    return shops.map((shop) => ({
      ...shop,
      currentAttendance: 0,
      currentReportedAttendance: null
    }));
  }

  try {
    // Get all attendance keys for current attendance
    const allKeys = await redis.keys('nearcade:attend:*');

    // Create a map to store attendance counts per shop
    const attendanceMap = new Map<string, number>();

    // Count unique users per shop
    for (const key of allKeys) {
      // Key format: nearcade:attend:${source}-${id}:${userId}:${attendedAt}:${gameId},...
      const keyParts = key.split(':');
      if (keyParts.length === 6) {
        const shopIdentifier = keyParts[2]; // source-id
        const count = attendanceMap.get(shopIdentifier) || 0;
        attendanceMap.set(shopIdentifier, count + 1);
      }
    }

    // Build list of Redis keys for reported attendance
    const reportedKeys: string[] = [];
    const shopGameMap = new Map<string, Array<{ gameId: number; keyIndex: number }>>();

    for (const shop of shops) {
      const shopIdentifier = `${shop.source}-${shop.id}`;
      const gameKeys: Array<{ gameId: number; keyIndex: number }> = [];

      for (const game of shop.games) {
        const reportKey = `nearcade:attend-report:${shopIdentifier}:${game.gameId}`;
        gameKeys.push({ gameId: game.gameId, keyIndex: reportedKeys.length });
        reportedKeys.push(reportKey);
      }
      shopGameMap.set(shopIdentifier, gameKeys);
    }

    // Use MGET to efficiently get all reported attendance values
    let reportedValues: (string | null)[] = [];
    if (reportedKeys.length > 0) {
      const mgetResult = await redis.mGet(reportedKeys);
      reportedValues = mgetResult as (string | null)[];
    }

    // Process reported attendance data and collect user IDs
    const usersSet = new Set<string>();
    const shopReportedData = new Map<
      string,
      {
        total: number;
        latestReportedAt: string | null;
        latestReportedBy: string | null;
      }
    >();

    for (const shop of shops) {
      const shopIdentifier = `${shop.source}-${shop.id}`;
      const gameKeys = shopGameMap.get(shopIdentifier) || [];

      let total = 0;
      let latestReportedAt: string | null = null;
      let latestReportedBy: string | null = null;

      for (const { keyIndex } of gameKeys) {
        const value = reportedValues[keyIndex];
        if (value) {
          try {
            const parsed = JSON.parse(value) as {
              currentAttendances: number;
              reportedBy: string;
              reportedAt: string;
            };

            total += parsed.currentAttendances;
            usersSet.add(parsed.reportedBy);

            if (!latestReportedAt || new Date(parsed.reportedAt) > new Date(latestReportedAt)) {
              latestReportedAt = parsed.reportedAt;
              latestReportedBy = parsed.reportedBy;
            }
          } catch (parseError) {
            console.error('Error parsing reported attendance data:', parseError);
          }
        }
      }

      shopReportedData.set(shopIdentifier, {
        total,
        latestReportedAt,
        latestReportedBy
      });
    }

    // Fetch all users in one go using $in operator
    const userIds = Array.from(usersSet);
    const usersMap = new Map<string, User>();

    if (userIds.length > 0) {
      const db = mongo.db();
      const users = await db
        .collection<User>('users')
        .find({ id: { $in: userIds } })
        .toArray();

      for (const user of users) {
        if (user.id) {
          usersMap.set(user.id, user);
        }
      }
    }

    // Combine attendance and reported data for each shop
    return shops.map((shop) => {
      const shopIdentifier = `${shop.source}-${shop.id}`;
      const currentAttendance = attendanceMap.get(shopIdentifier) || 0;
      const reportedData = shopReportedData.get(shopIdentifier);

      let currentReportedAttendance: {
        count: number;
        reportedAt: string;
        reportedBy: User;
      } | null = null;

      if (
        reportedData &&
        reportedData.total > 0 &&
        reportedData.latestReportedAt &&
        reportedData.latestReportedBy
      ) {
        const reportedBy = usersMap.get(reportedData.latestReportedBy);
        if (reportedBy) {
          currentReportedAttendance = {
            count: reportedData.total,
            reportedAt: reportedData.latestReportedAt,
            reportedBy
          };
        }
      }

      return {
        ...shop,
        currentAttendance,
        currentReportedAttendance
      };
    });
  } catch (error) {
    console.error('Failed to get attendance data:', error);
    return shops.map((shop) => ({
      ...shop,
      currentAttendance: 0,
      currentReportedAttendance: null
    }));
  }
};

export const load: PageServerLoad = async ({ locals }) => {
  const user = locals.user;

  if (!user) {
    return {
      starredShops: [],
      joinedClubsStarredShops: []
    };
  }

  try {
    const db = mongo.db();

    // Get user's starred shops
    const starredShopsQuery = db.collection('starred_arcades').find({ userId: user.id });
    const starredArcadeIds = (await starredShopsQuery.toArray()).map((s) => s.arcadeId);

    let starredShops: Shop[] = [];
    if (starredArcadeIds.length > 0) {
      const starredShopsQuery = db
        .collection<Shop>('shops')
        .find({
          $or: starredArcadeIds.map((id) => ({
            id: Number(id.split('-')[1]),
            source: id.split('-')[0]
          }))
        })
        .limit(20);

      starredShops = await starredShopsQuery.toArray();
    }

    // Get user's joined clubs
    const joinedClubsQuery = db
      .collection('club_members')
      .find({ userId: user.id })
      .project({ clubId: 1 });

    const joinedClubIds = (await joinedClubsQuery.toArray()).map((m) => m.clubId);

    let joinedClubsStarredShops: Shop[] = [];
    if (joinedClubIds.length > 0) {
      // Get starred shops of joined clubs
      const clubStarredQuery = db.collection('starred_arcades').find({
        clubId: { $in: joinedClubIds }
      });

      const clubStarredArcadeIds = (await clubStarredQuery.toArray()).map((s) => s.arcadeId);

      if (clubStarredArcadeIds.length > 0) {
        const clubStarredShopsQuery = db
          .collection<Shop>('shops')
          .find({
            $or: clubStarredArcadeIds.map((id) => ({
              id: Number(id.split('-')[1]),
              source: id.split('-')[0]
            }))
          })
          .limit(20);

        joinedClubsStarredShops = await clubStarredShopsQuery.toArray();
      }
    }

    // Get attendance data for all shops
    const allShops = [...starredShops, ...joinedClubsStarredShops];
    const shopsWithAttendance = await getShopAttendanceData(allShops);

    // Split back into starred and club starred shops
    const starredShopsWithAttendance = shopsWithAttendance.slice(0, starredShops.length);
    const joinedClubsStarredShopsWithAttendance = shopsWithAttendance.slice(starredShops.length);

    return {
      starredShops: toPlainArray(starredShopsWithAttendance),
      joinedClubsStarredShops: toPlainArray(joinedClubsStarredShopsWithAttendance)
    };
  } catch (error) {
    console.error('Failed to load starred shops:', error);
    return {
      starredShops: [],
      joinedClubsStarredShops: []
    };
  }
};
