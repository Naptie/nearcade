import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createClient } from 'redis';
import { env } from '$env/dynamic/private';
import client from '$lib/db/index.server';
import type { AttendanceData, Shop } from '$lib/types';
import { getNextTimeAtHour } from '$lib/utils';
import { ShopSource } from '$lib/constants';
import type { User } from '@auth/sveltekit';

// Redis client for attendance tracking
let redisClient: ReturnType<typeof createClient> | null = null;

async function getRedisClient() {
  if (!redisClient && env.REDIS_URI) {
    redisClient = createClient({ url: env.REDIS_URI });
    await redisClient.connect();
  }
  return redisClient;
}

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const session = await locals.auth();

  if (!session?.user) {
    return error(401, 'Unauthorized');
  }

  try {
    const body = (await request.json()) as {
      games: { id: number; version: string; currentAttendances?: number }[];
      plannedLeaveAt: string;
    };
    const { games, plannedLeaveAt } = body;

    // Validate input
    if (!games || !plannedLeaveAt) {
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
    const db = client.db();
    const shopsCollection = db.collection<Shop>('shops');
    const shop = await shopsCollection.findOne({
      source,
      id
    });

    if (!shop) {
      return error(404, 'Shop not found');
    }

    // Validate game exists in shop
    const shopGames = shop.games.filter((sg) =>
      games.some((g) => g.id === sg.id && g.version === sg.version)
    );
    if (shopGames.length !== games.length) {
      return error(404, 'Games missing in shop');
    }

    const plannedLeaveTime = new Date(plannedLeaveAt);

    if (
      plannedLeaveTime < new Date(Date.now() + 10 * 60 * 1000) ||
      plannedLeaveTime > getNextTimeAtHour(shop.location, 6)
    ) {
      return error(400, 'Invalid planned leave time');
    }

    // Get Redis client
    const redis = await getRedisClient();
    if (!redis) {
      return error(500, 'Redis not available');
    }

    const attendanceKey = `nearcade:attend:${source}-${id}:${session.user.id}`;
    const attendanceData = {
      games: shopGames.map((g, index) => ({
        id: g.id,
        version: g.version,
        currentAttendances: games[index]?.currentAttendances
      })),
      attendedAt: new Date().toISOString(),
      plannedLeaveAt: plannedLeaveTime.toISOString()
    };

    // Calculate TTL in seconds
    const now = Date.now();
    const plannedLeave = new Date(plannedLeaveAt).getTime();
    const ttlSeconds = Math.max(Math.floor((plannedLeave - now) / 1000), 60); // Minimum 60 seconds

    // Store attendance in Redis with expiration
    await redis.setEx(attendanceKey, ttlSeconds, JSON.stringify(attendanceData));

    return json({ success: true, attendanceKey, ttlSeconds });
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

    // Get Redis client
    const redis = await getRedisClient();
    if (!redis) {
      return error(500, 'Redis not available');
    }

    const attendanceKey = `nearcade:attend:${source}-${id}:${session.user.id}`;

    // Get the attendance data before deleting
    const attendanceDataStr = await redis.get(attendanceKey);
    if (!attendanceDataStr) {
      return error(404, 'Attendance not found');
    }

    const attendanceData = JSON.parse(attendanceDataStr);

    // Delete from Redis
    await redis.del(attendanceKey);

    // Add to MongoDB attendances collection
    const db = client.db();
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
export const GET: RequestHandler = async ({ params }) => {
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

    // Get Redis client
    const redis = await getRedisClient();
    if (!redis) {
      return error(500, 'Redis not available');
    }

    // Get all attendance keys for this shop
    const pattern = `nearcade:attend:${source}-${id}:*`;
    const keys = await redis.keys(pattern);

    const attendanceData: AttendanceData = [];
    const usersSet = new Set<string>();

    // Process each attendance key
    for (const key of keys) {
      const dataStr = await redis.get(key);
      if (dataStr) {
        const data = JSON.parse(dataStr);
        const keyParts = key.split(':');
        const userId = keyParts[3];
        data.games.forEach((game: { id: number; version: string; currentAttendances?: number }) => {
          usersSet.add(userId);
          attendanceData.push({
            userId,
            game: {
              id: game.id,
              version: game.version,
              currentAttendances: game.currentAttendances
            },
            attendedAt: data.attendedAt,
            plannedLeaveAt: data.plannedLeaveAt
          });
        });
      }
    }

    const db = client.db();
    const usersCollection = db.collection<User>('users');
    const users = await usersCollection.find({ id: { $in: Array.from(usersSet) } }).toArray();
    attendanceData.forEach((entry) => {
      entry.user = users.find((u) => u.id === entry.userId) as User;
    });

    return json({ success: true, attendanceData });
  } catch (err) {
    console.error('Error getting attendance:', err);
    return error(500, 'Failed to get attendance');
  }
};
