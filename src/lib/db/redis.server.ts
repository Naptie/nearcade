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

if (process.env.NODE_ENV === 'development') {
  // In development mode, use a global variable so that the value
  // is preserved across module reloads caused by HMR (Hot Module Replacement).
  const globalWithRedis = global as typeof globalThis & {
    _redisClient?: RedisClient;
    _redisConnectPromise?: Promise<void>;
  };

  if (!globalWithRedis._redisClient) {
    globalWithRedis._redisClient = createRedisClient();
    // Connect immediately and cache the promise
    globalWithRedis._redisConnectPromise = globalWithRedis._redisClient
      .connect()
      .then(() => {
        // Intentionally empty - connection successful
      })
      .catch((err) => {
        console.error('[Redis] Initial connection failed:', err);
      });
  }
  redis = globalWithRedis._redisClient;
} else {
  // In production mode, it's best to not use a global variable.
  redis = createRedisClient();
  // Connect immediately
  redis.connect().catch((err) => {
    console.error('[Redis] Initial connection failed:', err);
  });
}

/**
 * Ensures the Redis client is connected before performing operations.
 * This function should be called before any Redis operation.
 */
export const ensureConnected = async (): Promise<void> => {
  if (!redis.isOpen) {
    await redis.connect();
  }
};

// Export a module-scoped Redis client. By doing this in a
// separate module, the client can be shared across functions.
// The client maintains a persistent connection and automatically
// reconnects on connection loss.
export default redis;
