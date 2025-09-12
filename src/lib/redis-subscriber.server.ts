import { createClient } from 'redis';
import { env } from '$env/dynamic/private';
import client from '$lib/db/index.server';

let subscriberClient: ReturnType<typeof createClient> | null = null;
let isSubscriberStarted = false;

async function getSubscriberClient() {
  if (!subscriberClient && env.REDIS_URI) {
    subscriberClient = createClient({ url: env.REDIS_URI });
    await subscriberClient.connect();
  }
  return subscriberClient;
}

// Start Redis keyspace notifications subscriber for attendance key expirations
export async function startAttendanceExpirationSubscriber() {
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
}

async function handleAttendanceExpiration(expiredKey: string) {
  try {
    console.log('Processing expired attendance key:', expiredKey);

    // Parse the key to extract shop and user information
    // Key format: nearcade:attend:${source}-${id}:${userId}
    const keyParts = expiredKey.split(':');
    if (keyParts.length !== 4) {
      console.error('Invalid attendance key format:', expiredKey);
      return;
    }

    const shopPart = keyParts[2]; // source-id
    const userId = keyParts[3];

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

    // We need to get a separate Redis client for data operations
    // since the subscriber client is dedicated to subscriptions
    const dataClient = createClient({ url: env.REDIS_URI });
    await dataClient.connect();

    try {
      // Try to get the attendance data (might be null if already expired)
      const attendanceDataStr = await dataClient.get(expiredKey);

      let attendanceData;
      if (attendanceDataStr) {
        attendanceData = JSON.parse(attendanceDataStr);
      } else {
        // If the data is no longer in Redis, we still want to create a record
        // but with limited information
        console.warn('Attendance data not found for expired key:', expiredKey);
        attendanceData = {
          games: [], // We don't know which games were attended
          attendedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // Estimate 24h ago
          plannedLeaveAt: new Date().toISOString() // Now
        };
      }

      // Add to MongoDB attendances collection
      const db = client.db();
      const attendancesCollection = db.collection('attendances');

      await attendancesCollection.insertOne({
        userId,
        games: attendanceData.games || [],
        shop: {
          id,
          source
        },
        attendedAt: new Date(attendanceData.attendedAt),
        leftAt: new Date(), // Expiration time as leave time
        reason: 'expired' // Mark as expired rather than manually left
      });

      console.log(`Attendance record created for expired key: ${expiredKey}`);
    } finally {
      await dataClient.quit();
    }
  } catch (error) {
    console.error('Error handling attendance expiration:', error);
  }
}

// Gracefully shutdown the subscriber
export async function stopAttendanceExpirationSubscriber() {
  if (subscriberClient) {
    await subscriberClient.unsubscribe();
    await subscriberClient.quit();
    subscriberClient = null;
    isSubscriberStarted = false;
    console.log('Redis attendance expiration subscriber stopped');
  }
}
