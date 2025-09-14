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
const startAttendanceExpirationSubscriber = async () => {
  if (isSubscriberStarted) {
    return;
  }

  const subscriber = await getSubscriberClient();
  if (!subscriber) {
    console.warn('Redis not available, attendance expiration subscriber not started');
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
    console.log('Redis attendance expiration subscriber started');
  } catch (error) {
    console.error('Failed to start attendance expiration subscriber:', error);
  }
};

const handleAttendanceExpiration = async (expiredKey: string) => {
  try {
    console.log('Processing expired attendance key:', expiredKey);

    // Parse the key to extract shop and user information
    // Key format: nearcade:attend:${source}-${id}:${userId}:${attendedAt}:${gameId},...
    const keyParts = expiredKey.split(':');
    if (keyParts.length !== 6) {
      console.error('Invalid attendance key format:', expiredKey);
      return;
    }

    const shopPart = keyParts[2]; // source-id
    const userId = keyParts[3];
    const attendedAt = decodeURIComponent(keyParts[4]);
    const games = keyParts[5].split(',').map((g) => parseInt(g)); // gameId

    const shopInfo = shopPart.split('-');
    if (shopInfo.length < 2) {
      console.error('Invalid shop info in key:', expiredKey);
      return;
    }

    const source = shopInfo[0];
    const id = parseInt(shopInfo.slice(1).join('-')); // Handle sources with dashes

    if (isNaN(id)) {
      console.error('Invalid shop ID in key:', expiredKey);
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

    console.log(`Attendance record created for expired key: ${expiredKey}`);
  } catch (error) {
    console.error('Error handling attendance expiration:', error);
  }
};

// Gracefully shutdown the subscriber
const stopAttendanceExpirationSubscriber = async () => {
  if (subscriberClient) {
    await subscriberClient.unsubscribe();
    await subscriberClient.quit();
    subscriberClient = null;
    isSubscriberStarted = false;
    console.log('Redis attendance expiration subscriber stopped');
  }
};

try {
  await startAttendanceExpirationSubscriber();
} catch (err) {
  console.error('Fatal error:', err);
  await stopAttendanceExpirationSubscriber();
  process.exit(1);
}
