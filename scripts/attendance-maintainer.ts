import { createClient } from 'redis';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

if (!('MONGODB_URI' in process.env)) {
  // Load environment variables for local development
  dotenv.config();
}

const { REDIS_URI, MONGODB_URI } = process.env;

const mongo = new MongoClient(MONGODB_URI!);

let subscriberClient: ReturnType<typeof createClient> | null = null;
let isSubscriberStarted = false;

const getSubscriberClient = async () => {
  if (!subscriberClient && REDIS_URI) {
    subscriberClient = createClient({ url: REDIS_URI });
    await subscriberClient.connect();
  }
  return subscriberClient;
};

// Start Redis keyspace notifications subscriber for attendance key expirations
const startSubscriber = async () => {
  if (isSubscriberStarted) {
    return;
  }

  const subscriber = await getSubscriberClient();
  if (!subscriber) {
    console.warn('[Attendance] Redis not available, subscriber not started');
    return;
  }

  try {
    // Enable keyspace notifications for expired events if not already enabled
    await subscriber.configSet('notify-keyspace-events', 'Ex');

    // Subscribe to keyspace notifications for expired keys
    await subscriber.subscribe('__keyevent@0__:expired', async (message) => {
      // Only process attendance keys
      if (message.startsWith('nearcade:attend:')) {
        await handleAttendanceExpiration(message);
      }
    });

    isSubscriberStarted = true;
    console.log('[Attendance] Redis subscriber started');
  } catch (error) {
    console.error('[Attendance] Failed to start subscriber:', error);
  }
};

const handleAttendanceExpiration = async (expiredKey: string) => {
  try {
    console.log('[Attendance] Processing key:', expiredKey);

    // Parse the key to extract shop and user information
    // Key format: nearcade:attend:${source}-${id}:${userId}:${attendedAt}:${gameId},...
    const keyParts = expiredKey.split(':');
    if (keyParts.length !== 6) {
      console.error('[Attendance] Invalid key format:', expiredKey);
      return;
    }

    const shopPart = keyParts[2]; // source-id
    const userId = keyParts[3];
    const attendedAt = decodeURIComponent(keyParts[4]);
    const games = keyParts[5].split(',').map((g) => parseInt(g)); // gameId

    const shopInfo = shopPart.split('-');
    if (shopInfo.length < 2) {
      console.error('[Attendance] Invalid shop info in key:', expiredKey);
      return;
    }

    const source = shopInfo[0];
    const id = parseInt(shopInfo.slice(1).join('-')); // Handle sources with dashes

    if (isNaN(id)) {
      console.error('[Attendance] Invalid shop ID in key:', expiredKey);
      return;
    }

    const db = mongo.db();
    const shopsCollection = db.collection('shops');
    const shop = await shopsCollection.findOne({ id, source });

    const attendanceData = {
      games: games.map((gameId) => {
        const game = shop?.games.find((g: { gameId: number }) => g.gameId === gameId);
        return {
          gameId,
          name: game.name,
          version: game.version
        };
      }),
      attendedAt: new Date(attendedAt).toISOString(),
      plannedLeaveAt: new Date().toISOString() // Now
    };

    // Add to MongoDB attendances collection
    const attendancesCollection = db.collection('attendances');

    await attendancesCollection.insertOne({
      userId,
      games: attendanceData.games || [],
      shop: {
        id,
        source
      },
      attendedAt: new Date(attendanceData.attendedAt),
      leftAt: new Date(attendanceData.plannedLeaveAt)
    });

    console.log(`[Attendance] Record created for key: ${expiredKey}`);
  } catch (error) {
    console.error('[Attendance] Error:', error);
  }
};

// Gracefully shutdown the subscriber
const stopSubscriber = async () => {
  if (subscriberClient) {
    await subscriberClient.unsubscribe();
    await subscriberClient.quit();
    subscriberClient = null;
    isSubscriberStarted = false;
    console.log('[Attendance] Redis subscriber stopped');
  }
};

try {
  await startSubscriber();
} catch (err) {
  console.error('[Attendance] Fatal error:', err);
  await stopSubscriber();
  process.exit(1);
}
