import { env } from '$env/dynamic/private';
import { MongoClient, ServerApiVersion } from 'mongodb';

if (!env.MONGODB_URI) {
  throw new Error('Invalid/Missing environment variable: "MONGODB_URI"');
}

const uri = env.MONGODB_URI;
const options = {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true
  }
};

let mongo: MongoClient;

if (process.env.NODE_ENV === 'development') {
  // In development mode, use a global variable so that the value
  // is preserved across module reloads caused by HMR (Hot Module Replacement).
  const globalWithMongo = global as typeof globalThis & {
    _mongoClient?: MongoClient;
  };

  if (!globalWithMongo._mongoClient) {
    globalWithMongo._mongoClient = new MongoClient(uri, options);
  }
  mongo = globalWithMongo._mongoClient;
} else {
  // In production mode, it's best to not use a global variable.
  mongo = new MongoClient(uri, options);
}

// Export a module-scoped MongoClient. By doing this in a
// separate module, the client can be shared across functions.
export default mongo;
