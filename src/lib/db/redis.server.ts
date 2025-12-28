import { env } from '$env/dynamic/private';
import { createClient } from 'redis';

if (!env.REDIS_URI) {
  throw new Error('Invalid/Missing environment variable: "REDIS_URI"');
}

const url = env.REDIS_URI;

/**
 * Creates and configures a Redis client with proper reconnection handling
 * for persistent Node.js deployments (non-serverless environments).
 *
 * The client automatically reconnects on connection loss or timeout,
 * using exponential backoff with a maximum delay of 10 seconds.
 */
const createRedisClient = () => {
  const client = createClient({
    url,
    socket: {
      reconnectStrategy: (retries) => {
        // Exponential backoff with max delay of 10 seconds
        const delay = Math.min(retries * 100, 10000);
        console.log(`[Redis] Reconnecting in ${delay}ms (attempt ${retries})`);
        return delay;
      }
    }
  });

  client.on('error', (err) => {
    console.error('[Redis] Client error:', err);
  });

  client.on('connect', () => {
    console.log('[Redis] Connected');
  });

  client.on('reconnecting', () => {
    console.log('[Redis] Reconnecting...');
  });

  client.on('ready', () => {
    console.log('[Redis] Ready');
  });

  return client;
};

type RedisClient = ReturnType<typeof createRedisClient>;

let redis: RedisClient;
let connectPromise: Promise<void> | null = null;

if (process.env.NODE_ENV === 'development') {
  // In development mode, use a global variable so that the value
  // is preserved across module reloads caused by HMR (Hot Module Replacement).
  const globalWithRedis = global as typeof globalThis & {
    _redisClient?: RedisClient;
    _redisConnectPromise?: Promise<void> | null;
  };

  if (!globalWithRedis._redisClient) {
    globalWithRedis._redisClient = createRedisClient();
    // Connect immediately and cache the promise
    globalWithRedis._redisConnectPromise = globalWithRedis._redisClient
      .connect()
      .then(() => {
        globalWithRedis._redisConnectPromise = null;
      })
      .catch((err) => {
        globalWithRedis._redisConnectPromise = null;
        console.error('[Redis] Initial connection failed:', err);
      });
  }
  redis = globalWithRedis._redisClient;
  connectPromise = globalWithRedis._redisConnectPromise ?? null;
} else {
  // In production mode, it's best to not use a global variable.
  redis = createRedisClient();
  // Connect immediately and cache the promise
  connectPromise = redis
    .connect()
    .then(() => {
      connectPromise = null;
    })
    .catch((err) => {
      connectPromise = null;
      console.error('[Redis] Initial connection failed:', err);
    });
}

/**
 * Ensures the Redis client is connected before performing operations.
 * This function should be called before any Redis operation.
 * Uses a cached connection promise to prevent multiple concurrent connection attempts.
 */
export const ensureConnected = async (): Promise<void> => {
  // If there's an ongoing connection attempt, wait for it
  if (connectPromise) {
    await connectPromise;
  }
  // If still not open after awaiting, try to connect
  if (!redis.isOpen) {
    connectPromise = redis
      .connect()
      .then(() => {
        connectPromise = null;
      })
      .catch((err) => {
        connectPromise = null;
        throw err;
      });
    await connectPromise;
  }
};

// Export a module-scoped Redis client. By doing this in a
// separate module, the client can be shared across functions.
// The client maintains a persistent connection and automatically
// reconnects on connection loss.
export default redis;
