import { env } from '$env/dynamic/private';
import { createClient } from 'redis';

/**
 * Creates and configures a Redis client with proper reconnection handling.
 *
 * The client automatically reconnects on connection loss or timeout,
 * using exponential backoff with a maximum delay of 10 seconds.
 */
const createRedisClient = () => {
  const url = env.REDIS_URI;

  if (!url) {
    throw new Error('Invalid/Missing environment variable: "REDIS_URI"');
  }

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

let redis: RedisClient | undefined;
let connectPromise: Promise<void> | null = null;

const getRedisClient = (): RedisClient => {
  if (process.env.NODE_ENV === 'development') {
    // In development mode, use a global variable so that the value
    // is preserved across module reloads caused by HMR (Hot Module Replacement).
    const globalWithRedis = global as typeof globalThis & {
      _redisClient?: RedisClient;
      _redisConnectPromise?: Promise<void> | null;
    };

    if (!globalWithRedis._redisClient) {
      globalWithRedis._redisClient = createRedisClient();
    }

    return globalWithRedis._redisClient;
  }

  if (!redis) {
    redis = createRedisClient();
  }

  return redis;
};

const getConnectPromise = () => {
  if (process.env.NODE_ENV === 'development') {
    const globalWithRedis = global as typeof globalThis & {
      _redisConnectPromise?: Promise<void> | null;
    };

    return globalWithRedis._redisConnectPromise ?? null;
  }

  return connectPromise;
};

const setConnectPromise = (promise: Promise<void> | null) => {
  if (process.env.NODE_ENV === 'development') {
    const globalWithRedis = global as typeof globalThis & {
      _redisConnectPromise?: Promise<void> | null;
    };

    globalWithRedis._redisConnectPromise = promise;
    return;
  }

  connectPromise = promise;
};

const redisProxy = new Proxy({} as RedisClient, {
  get(_target, property) {
    const client = getRedisClient();
    const value = Reflect.get(client, property, client);

    return typeof value === 'function' ? value.bind(client) : value;
  }
});

export const ensureConnected = async (): Promise<void> => {
  const client = getRedisClient();
  const ongoingConnection = getConnectPromise();

  // If there's an ongoing connection attempt, wait for it.
  if (ongoingConnection) {
    await ongoingConnection;
  }

  // If still not open after awaiting, try to connect.
  if (!client.isOpen) {
    const newConnection = client
      .connect()
      .then(() => {
        setConnectPromise(null);
      })
      .catch((err) => {
        setConnectPromise(null);
        throw err;
      });

    setConnectPromise(newConnection);
    await newConnection;
  }
};

// In development mode, use a global variable so that the value
// is preserved across module reloads caused by HMR (Hot Module Replacement).
if (process.env.NODE_ENV === 'development') {
  const globalWithRedis = global as typeof globalThis & {
    _redisClient?: RedisClient;
    _redisConnectPromise?: Promise<void> | null;
  };

  globalWithRedis._redisClient ??= redis;
  globalWithRedis._redisConnectPromise ??= connectPromise;
}

// Export a module-scoped Redis client. By doing this in a
// separate module, the client can be shared across functions.
// The client maintains a persistent connection and automatically
// reconnects on connection loss.
export default redisProxy;
