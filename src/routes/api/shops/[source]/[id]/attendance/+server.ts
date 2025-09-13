import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import redis from '$lib/db/redis.server';
import type { AttendanceData, AttendanceReport, Shop } from '$lib/types';
import { getNextTimeAtHour } from '$lib/utils';
import { ShopSource } from '$lib/constants';
import type { User } from '@auth/sveltekit';

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const session = await locals.auth();

  if (!session?.user) {
    return error(401, 'Unauthorized');
  }

  try {
    const body = (await request.json()) as {
      games: { id: number; version: string; currentAttendances?: number }[];
      plannedLeaveAt?: string;
    };
    const { games, plannedLeaveAt } = body;

    // Validate input
    if (!games || (games.every((g) => g.currentAttendances === undefined) && !plannedLeaveAt)) {
      return error(400, 'Missing required parameters');
    }

    const source = params.source as ShopSource;

    // Validate shop source
    if (!Object.values(ShopSource).includes(source)) {
      return error(400, 'Invalid shop source');
    }

    const idRaw = params.id;
    const id = parseInt(idRaw);

    if (isNaN(id)) {
      return error(400, 'Invalid shop ID');
    }

    // Validate shop exists
    const db = mongo.db();
    const shopsCollection = db.collection<Shop>('shops');
    const shop = await shopsCollection.findOne({
      source,
      id
    });

    if (!shop) {
      return error(404, 'Shop not found');
    }

    // Check for existing attendance
    const pattern = `nearcade:attend:${source}-${id}:${session.user.id}:*`;
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      return error(409, 'Attendance already exists');
    }

    // Validate game exists in shop
    const shopGames = shop.games.filter((sg) =>
      games.some((g) => g.id === sg.id && g.version === sg.version)
    );
    if (shopGames.length !== games.length) {
      return error(404, 'Games missing in shop');
    }

    if (!redis) {
      return error(500, 'Redis not available');
    }

    const now = Date.now();
    const refreshTime = getNextTimeAtHour(shop.location, 6);

    if (plannedLeaveAt) {
      const plannedLeaveTime = new Date(plannedLeaveAt);

      if (
        plannedLeaveTime < new Date(Date.now() + 8 * 60 * 1000) ||
        plannedLeaveTime > refreshTime
      ) {
        return error(400, 'Invalid planned leave time');
      }

      const attendedAt = new Date().toISOString();
      const attendanceKey = `nearcade:attend:${source}-${id}:${session.user.id}:${encodeURIComponent(attendedAt)}:${shopGames.map((g) => `${g.id}-${encodeURIComponent(g.version)}`).join(',')}`;
      const attendanceData = {
        games: shopGames.map((g) => ({
          id: g.id,
          version: g.version
        })),
        attendedAt,
        plannedLeaveAt: plannedLeaveTime.toISOString()
      };

      // Calculate TTL in seconds
      const plannedLeave = plannedLeaveTime.getTime();
      const ttlSeconds = Math.max(Math.floor((plannedLeave - now) / 1000), 60); // Minimum 60 seconds

      // Store attendance in Redis with expiration
      await redis.setEx(attendanceKey, ttlSeconds, JSON.stringify(attendanceData));
    } else if (games.some((g) => g.currentAttendances !== undefined)) {
      for (const game of games) {
        if (game.currentAttendances === undefined || game.currentAttendances < 0) {
          return error(400, `Invalid current attendances for game ${game.id} [${game.version}]`);
        }
        const attendanceKey = `nearcade:attend-report:${source}-${id}:${game.id}:${encodeURIComponent(game.version)}`;
        const attendanceData = {
          currentAttendances: game.currentAttendances,
          reportedBy: session.user.id,
          reportedAt: new Date().toISOString()
        };
        const ttlSeconds = Math.max(Math.floor((refreshTime.getTime() - now) / 1000), 60); // Minimum 60 seconds

        // Store attendance in Redis
        await redis.setEx(attendanceKey, ttlSeconds, JSON.stringify(attendanceData));
      }
    }

    return json({ success: true });
  } catch (err) {
    console.error('Error creating attendance:', err);
    return error(500, 'Failed to create attendance');
  }
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const session = await locals.auth();

  if (!session?.user) {
    return error(401, 'Unauthorized');
  }

  try {
    const source = params.source as ShopSource;

    // Validate shop source
    if (!Object.values(ShopSource).includes(source)) {
      return error(400, 'Invalid shop source');
    }

    const idRaw = params.id;
    const id = parseInt(idRaw);

    if (isNaN(id)) {
      return error(400, 'Invalid shop ID');
    }

    if (!redis) {
      return error(500, 'Redis not available');
    }

    const pattern = `nearcade:attend:${source}-${id}:${session.user.id}:*`;
    const keys = await redis.keys(pattern);
    if (keys.length === 0) {
      return error(404, 'Attendance not found');
    }

    // Only one active attendance per user per shop
    const attendanceKey = keys[0];

    // Get the attendance data before deleting
    const attendanceDataStr = await redis.get(attendanceKey);
    if (!attendanceDataStr) {
      return error(404, 'Attendance not found');
    }

    const attendanceData = JSON.parse(attendanceDataStr);

    // Delete from Redis
    await redis.del(attendanceKey);

    // Add to MongoDB attendances collection
    const db = mongo.db();
    const attendancesCollection = db.collection('attendances');

    await attendancesCollection.insertOne({
      userId: session.user.id,
      games: attendanceData.games,
      shop: {
        id,
        source
      },
      attendedAt: new Date(attendanceData.attendedAt),
      leftAt: new Date() // Actual leave time
    });

    return json({ success: true });
  } catch (err) {
    console.error('Error removing attendance:', err);
    return error(500, 'Failed to remove attendance');
  }
};

// GET endpoint to retrieve attendance data for a shop
export const GET: RequestHandler = async ({ params, url }) => {
  try {
    const fetchReported = ['1', 'true'].includes(url.searchParams.get('reported') || 'false');
    const source = params.source as ShopSource;

    // Validate shop source
    if (!Object.values(ShopSource).includes(source)) {
      return error(400, 'Invalid shop source');
    }

    const idRaw = params.id;
    const id = parseInt(idRaw);

    if (isNaN(id)) {
      return error(400, 'Invalid shop ID');
    }

    if (!redis) {
      return error(500, 'Redis not available');
    }

    // Get all attendance keys for this shop
    const pattern = fetchReported
      ? `nearcade:attend-report:${source}-${id}:*`
      : `nearcade:attend:${source}-${id}:*`;
    const keys = await redis.keys(pattern);

    const attendanceData: AttendanceReport | AttendanceData = [];
    const usersSet = new Set<string>();

    // Process each attendance key
    for (const key of keys) {
      const dataStr = await redis.get(key);
      if (dataStr) {
        const data = JSON.parse(dataStr);
        const keyParts = key.split(':');
        if (fetchReported) {
          const gameId = keyParts[3];
          const gameVersion = keyParts[4];
          (attendanceData as AttendanceReport).push({
            id: parseInt(gameId),
            version: decodeURIComponent(gameVersion),
            currentAttendances: data.currentAttendances,
            reportedBy: data.reportedBy,
            reportedAt: data.reportedAt
          });
          usersSet.add(data.reportedBy);
        } else {
          const userId = keyParts[3];
          data.games.forEach(
            (game: { id: number; version: string; currentAttendances?: number }) => {
              (attendanceData as AttendanceData).push({
                userId,
                game: {
                  id: game.id,
                  version: game.version
                },
                attendedAt: data.attendedAt,
                plannedLeaveAt: data.plannedLeaveAt
              });
              usersSet.add(userId);
            }
          );
        }
      }
    }

    const db = mongo.db();
    const usersCollection = db.collection<User>('users');
    const users = await usersCollection.find({ id: { $in: Array.from(usersSet) } }).toArray();
    attendanceData.forEach((entry) => {
      if ('userId' in entry) entry.user = users.find((u) => u.id === entry.userId) as User;
      else if ('reportedBy' in entry)
        entry.reporter = users.find((u) => u.id === entry.reportedBy) as User;
    });

    return json({ success: true, attendanceData });
  } catch (err) {
    console.error('Error getting attendance:', err);
    return error(500, 'Failed to get attendance');
  }
};
