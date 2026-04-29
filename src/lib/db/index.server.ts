import { env } from '$env/dynamic/private';
import { MongoClient, ServerApiVersion } from 'mongodb';

const options = {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true
  }
};

let mongo: MongoClient | undefined;

const createMongoClient = () => {
  const uri = env.MONGODB_URI;

  if (!uri) {
    throw new Error('Invalid/Missing environment variable: "MONGODB_URI"');
  }

  return new MongoClient(uri, options);
};

export const getMongoClient = (): MongoClient => {
  if (process.env.NODE_ENV === 'development') {
    // In development mode, use a global variable so that the value
    // is preserved across module reloads caused by HMR (Hot Module Replacement).
    const globalWithMongo = global as typeof globalThis & {
      _mongoClient?: MongoClient;
    };

    if (!globalWithMongo._mongoClient) {
      globalWithMongo._mongoClient = createMongoClient();
    }

    return globalWithMongo._mongoClient;
  }

  if (!mongo) {
    mongo = createMongoClient();
  }

  return mongo;
};

const mongoProxy = new Proxy({} as MongoClient, {
  get(_target, property) {
    const client = getMongoClient();
    const value = Reflect.get(client, property, client);

    return typeof value === 'function' ? value.bind(client) : value;
  }
});

// Export a module-scoped MongoClient. By doing this in a
// separate module, the client can be shared across functions.
export default mongoProxy;
