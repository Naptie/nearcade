import { env } from '$env/dynamic/private';
import { createClient } from 'redis';

if (!env.REDIS_URI) {
  throw new Error('Invalid/Missing environment variable: "REDIS_URI"');
}

const url = env.REDIS_URI;

let redis: ReturnType<typeof createClient>;

if (process.env.NODE_ENV === 'development') {
  // In development mode, use a global variable so that the value
  // is preserved across module reloads caused by HMR (Hot Module Replacement).
  const globalWithRedis = global as typeof globalThis & {
    _redisClient?: typeof redis;
  };

  if (!globalWithRedis._redisClient) {
    globalWithRedis._redisClient = createClient({ url });
  }
  redis = globalWithRedis._redisClient;
} else {
  // In production mode, it's best to not use a global variable.
  redis = createClient({ url });
}

// Export a module-scoped Redis client. By doing this in a
// separate module, the client can be shared across functions.
export default redis;
