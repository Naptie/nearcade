#!/usr/bin/env tsx

import { API_KEY_TABLE_NAME, defaultKeyHasher, type ApiKey } from '@better-auth/api-key';
import { MongoClient, MongoServerError, ObjectId, ServerApiVersion } from 'mongodb';
import dotenv from 'dotenv';

if (!('MONGODB_URI' in process.env)) {
  dotenv.config();
}

const MONGODB_URI = process.env.MONGODB_URI!;

if (!MONGODB_URI) {
  console.error('MONGODB_URI environment variable is required');
  process.exit(1);
}

const API_KEY_COLLECTION_NAME = `${API_KEY_TABLE_NAME}s`;
const DEFAULT_RATE_LIMIT_TIME_WINDOW = 1000 * 60 * 60 * 24;
const DEFAULT_RATE_LIMIT_MAX = 10;
const DEFAULT_API_KEY_PREFIX = 'nk_';
const DEFAULT_START_LENGTH = 6;
const DEFAULT_CONFIG_ID = 'default';
const DRY_RUN = process.argv.includes('--dry-run');

type LegacyApiToken = {
  id: string;
  name: string;
  token: string;
  shopId?: number;
  expiresAt: Date;
  createdAt: Date;
};

type UserWithLegacyApiTokens = {
  _id: ObjectId | string;
  id?: string;
  apiTokens?: LegacyApiToken[];
};

const serializeLegacyMetadata = (token: LegacyApiToken) => {
  if (token.shopId === undefined) {
    return null;
  }

  return JSON.stringify({ shopId: token.shopId });
};

const getLegacyPrefix = (token: string) => {
  const underscoreIndex = token.indexOf('_');

  if (underscoreIndex === -1) {
    return null;
  }

  return token.slice(0, underscoreIndex + 1);
};

const toReferenceId = (user: UserWithLegacyApiTokens) =>
  typeof user.id === 'string' && user.id.length > 0 ? user.id : String(user._id);

async function migrate() {
  const client = new MongoClient(MONGODB_URI, {
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
  });

  try {
    await client.connect();
    const db = client.db();
    const usersCollection = db.collection<UserWithLegacyApiTokens>('users');
    const apiKeysCollection = db.collection<
      Omit<ApiKey, 'id' | 'metadata' | 'permissions'> & {
        _id: string;
        metadata: string | null;
        permissions?: string | null;
      }
    >(API_KEY_COLLECTION_NAME);

    const usersWithLegacyTokens = usersCollection.find(
      {
        apiTokens: {
          $exists: true,
          $type: 'array',
          $ne: []
        }
      },
      {
        projection: { _id: 1, id: 1, apiTokens: 1 }
      }
    );

    let usersProcessed = 0;
    let usersCleared = 0;
    let tokensMigrated = 0;
    let duplicateTokens = 0;

    for await (const user of usersWithLegacyTokens) {
      const legacyTokens = user.apiTokens ?? [];
      if (legacyTokens.length === 0) {
        continue;
      }

      usersProcessed++;
      const referenceId = toReferenceId(user);

      for (const token of legacyTokens) {
        try {
          if (!DRY_RUN) {
            await apiKeysCollection.insertOne({
              _id: token.id,
              configId: DEFAULT_CONFIG_ID,
              name: token.name,
              start: token.token.slice(0, DEFAULT_START_LENGTH),
              prefix: getLegacyPrefix(token.token) ?? DEFAULT_API_KEY_PREFIX,
              key: await defaultKeyHasher(token.token),
              referenceId,
              refillInterval: null,
              refillAmount: null,
              lastRefillAt: null,
              enabled: true,
              rateLimitEnabled: false,
              rateLimitTimeWindow: DEFAULT_RATE_LIMIT_TIME_WINDOW,
              rateLimitMax: DEFAULT_RATE_LIMIT_MAX,
              requestCount: 0,
              remaining: null,
              lastRequest: null,
              expiresAt: token.expiresAt,
              createdAt: token.createdAt,
              updatedAt: new Date(),
              metadata: serializeLegacyMetadata(token),
              permissions: null
            });
          }

          tokensMigrated++;
        } catch (error) {
          if (error instanceof MongoServerError && error.code === 11000) {
            duplicateTokens++;
            continue;
          }

          throw error;
        }
      }

      if (!DRY_RUN) {
        await usersCollection.updateOne(
          { _id: user._id },
          {
            $unset: { apiTokens: '' }
          }
        );
      }

      usersCleared++;
    }

    console.log(`Legacy token migration ${DRY_RUN ? 'dry run ' : ''}complete.`);
    console.log(`Users processed: ${usersProcessed}`);
    console.log(`Users cleared: ${usersCleared}`);
    console.log(`Tokens migrated: ${tokensMigrated}`);
    console.log(`Duplicate tokens skipped: ${duplicateTokens}`);
  } finally {
    await client.close();
  }
}

migrate().catch((error) => {
  console.error('Legacy API token migration failed:', error);
  process.exit(1);
});
