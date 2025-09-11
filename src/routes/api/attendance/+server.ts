import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createClient } from 'redis';
import { env } from '$env/dynamic/private';
import client from '$lib/db/index.server';
import type { Shop } from '$lib/types';
import { ShopSource } from '$lib/constants';

// Redis client for attendance tracking
let redisClient: ReturnType<typeof createClient> | null = null;

async function getRedisClient() {
  if (!redisClient && env.REDIS_URI) {
    redisClient = createClient({ url: env.REDIS_URI });
    await redisClient.connect();
  }
  return redisClient;
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const session = await locals.auth();
  
  if (!session?.user) {
    return error(401, 'Unauthorized');
  }

  try {
    const { shopSource, shopId, gameId, plannedLeaveAt } = await request.json();
    
    // Validate input
    if (!shopSource || !shopId || !gameId || !plannedLeaveAt) {
      return error(400, 'Missing required parameters');
    }

    // Validate shop source
    if (!Object.values(ShopSource).includes(shopSource)) {
      return error(400, 'Invalid shop source');
    }

    // Validate shop exists
    const db = client.db();
    const shopsCollection = db.collection<Shop>('shops');
    const shop = await shopsCollection.findOne({
      source: shopSource,
      id: parseInt(shopId)
    });

    if (!shop) {
      return error(404, 'Shop not found');
    }

    // Validate game exists in shop
    const game = shop.games.find(g => g.id === parseInt(gameId));
    if (!game) {
      return error(404, 'Game not found in shop');
    }

    // Get Redis client
    const redis = await getRedisClient();
    if (!redis) {
      return error(500, 'Redis not available');
    }

    const attendanceKey = `nearcade:attend:${shopSource}-${shopId}:${gameId}:${session.user.id}`;
    const attendanceData = {
      attendedAt: new Date().toISOString(),
      plannedLeaveAt: new Date(plannedLeaveAt).toISOString()
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

export const DELETE: RequestHandler = async ({ request, locals }) => {
  const session = await locals.auth();
  
  if (!session?.user) {
    return error(401, 'Unauthorized');
  }

  try {
    const { shopSource, shopId, gameId } = await request.json();
    
    // Validate input
    if (!shopSource || !shopId || !gameId) {
      return error(400, 'Missing required parameters');
    }

    // Get Redis client
    const redis = await getRedisClient();
    if (!redis) {
      return error(500, 'Redis not available');
    }

    const attendanceKey = `nearcade:attend:${shopSource}-${shopId}:${gameId}:${session.user.id}`;
    
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
      game: parseInt(gameId),
      shop: {
        id: parseInt(shopId),
        source: shopSource
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
export const GET: RequestHandler = async ({ url }) => {
  try {
    const shopSource = url.searchParams.get('shopSource');
    const shopId = url.searchParams.get('shopId');
    
    if (!shopSource || !shopId) {
      return error(400, 'Missing shop parameters');
    }

    // Get Redis client
    const redis = await getRedisClient();
    if (!redis) {
      return error(500, 'Redis not available');
    }

    // Get all attendance keys for this shop
    const pattern = `nearcade:attend:${shopSource}-${shopId}:*`;
    const keys = await redis.keys(pattern);
    
    const attendanceData: Record<string, Array<{
      userId: string;
      attendedAt: string;
      plannedLeaveAt: string;
      gameId: number;
    }>> = {};

    // Process each attendance key
    for (const key of keys) {
      const dataStr = await redis.get(key);
      if (dataStr) {
        const data = JSON.parse(dataStr);
        const keyParts = key.split(':');
        const gameId = parseInt(keyParts[3]);
        const userId = keyParts[4];
        
        if (!attendanceData[gameId]) {
          attendanceData[gameId] = [];
        }
        
        attendanceData[gameId].push({
          userId,
          gameId,
          attendedAt: data.attendedAt,
          plannedLeaveAt: data.plannedLeaveAt
        });
      }
    }

    return json({ success: true, attendanceData });
  } catch (err) {
    console.error('Error getting attendance:', err);
    return error(500, 'Failed to get attendance');
  }
};