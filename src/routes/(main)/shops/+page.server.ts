import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Shop } from '$lib/types';
import { PAGINATION } from '$lib/constants';
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
  } catch (err) {
    console.error('Error getting attendance data:', err);
    // Return shops with zero attendance on error
    return shops.map((shop) => ({
      ...shop,
      currentAttendance: 0,
      currentReportedAttendance: null
    }));
  }
};

export const load: PageServerLoad = async ({ url, parent }) => {
  const query = url.searchParams.get('q') || '';
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = PAGINATION.PAGE_SIZE;
  const skip = (page - 1) * limit;

  try {
    const db = mongo.db();
    const shopsCollection = db.collection<Shop>('shops');

    let shops: Shop[];
    let totalCount: number;

    if (query.trim().length === 0) {
      // Load all shops with pagination
      totalCount = await shopsCollection.countDocuments();
      shops = (await shopsCollection
        .find({})
        .sort({ name: 1 })
        .collation({ locale: 'zh@collation=gb2312han' })
        .skip(skip)
        .limit(limit)
        .toArray()) as unknown as Shop[];
    } else {
      // Search shops
      let searchResults: Shop[];

      try {
        // Try Atlas Search first
        searchResults = (await shopsCollection
          .aggregate([
            {
              $search: {
                index: 'default',
                compound: {
                  should: [
                    {
                      text: {
                        query: query,
                        path: 'name',
                        score: { boost: { value: 2 } }
                      }
                    },
                    {
                      text: {
                        query: query,
                        path: 'generalAddress'
                      }
                    }
                  ]
                }
              }
            },
            { $sort: { score: { $meta: 'searchScore' }, name: 1 } },
            { $skip: skip },
            { $limit: limit }
          ])
          .toArray()) as unknown as Shop[];
      } catch {
        // Fallback to regex search
        const searchQuery = {
          $or: [
            { name: { $regex: query, $options: 'i' } },
            { generalAddress: { $elemMatch: { $regex: query, $options: 'i' } } }
          ]
        };

        totalCount = await shopsCollection.countDocuments(searchQuery);
        searchResults = (await shopsCollection
          .find(searchQuery)
          .sort({ name: 1 })
          .collation({ locale: 'zh@collation=gb2312han' })
          .skip(skip)
          .limit(limit)
          .toArray()) as unknown as Shop[];
      }

      shops = searchResults;
      if (!totalCount!) {
        totalCount = shops.length + (shops.length === limit ? 1 : 0);
      }
    }

    // Get real-time attendance data and reported attendance for all shops
    const shopsWithAttendance = await getShopAttendanceData(shops);

    const { session } = await parent();

    return {
      shops: toPlainArray(shopsWithAttendance),
      totalCount,
      currentPage: page,
      hasNextPage: skip + shops.length < totalCount,
      hasPrevPage: page > 1,
      query,
      user: session?.user
    };
  } catch (err) {
    console.error('Error loading shops:', err);
    error(500, 'Failed to load shops');
  }
};
