import { API_KEY_TABLE_NAME, defaultKeyHasher } from '@better-auth/api-key';
import { MongoServerError, ObjectId } from 'mongodb';
import type { ApiKey } from '@better-auth/api-key';
import mongo from '$lib/db/index.server';
import { auth } from './index.server';

const API_KEY_COLLECTION_NAME = `${API_KEY_TABLE_NAME}s`;
const DEFAULT_RATE_LIMIT_TIME_WINDOW = 1000 * 60 * 60 * 24;
const DEFAULT_RATE_LIMIT_MAX = 10;
const DEFAULT_API_KEY_PREFIX = 'nk_';
const DEFAULT_START_LENGTH = 6;
const DEFAULT_CONFIG_ID = 'default';

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
  apiTokens?: LegacyApiToken[];
};

export const getUserIdSelector = (userId: string) => {
  if (ObjectId.isValid(userId)) {
    return { _id: { $in: [new ObjectId(userId), userId] } };
  }

  return { _id: userId };
};

const getApiKeysCollection = () =>
  mongo.db().collection<
    Omit<ApiKey, 'id' | 'metadata' | 'permissions'> & {
      _id: string;
      metadata: string | null;
      permissions?: string | null;
    }
  >(API_KEY_COLLECTION_NAME);

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

async function migrateSingleLegacyApiToken(userId: string, token: LegacyApiToken) {
  const apiKeysCollection = getApiKeysCollection();

  try {
    await apiKeysCollection.insertOne({
      _id: token.id,
      configId: DEFAULT_CONFIG_ID,
      name: token.name,
      start: token.token.slice(0, DEFAULT_START_LENGTH),
      prefix: getLegacyPrefix(token.token) ?? DEFAULT_API_KEY_PREFIX,
      key: await defaultKeyHasher(token.token),
      referenceId: userId,
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
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      console.error(
        `Skipping duplicate legacy API key migration for token ${token.id} (userId: ${userId}).`
      );
      return;
    }

    throw error;
  }
}

export async function ensureLegacyApiTokensMigrated(userId: string) {
  const usersCollection = mongo.db().collection<UserWithLegacyApiTokens>('users');
  const user = await usersCollection.findOne(getUserIdSelector(userId), {
    projection: { apiTokens: 1 }
  });

  if (!user?.apiTokens?.length) {
    return;
  }

  for (const token of user.apiTokens) {
    await migrateSingleLegacyApiToken(userId, token);
  }

  await usersCollection.updateOne(getUserIdSelector(userId), {
    $unset: { apiTokens: '' }
  });
}

export async function verifyApiKeyWithLegacyFallback(key: string) {
  let result = await auth.api.verifyApiKey({
    body: { key }
  });

  if (result.valid) {
    return result;
  }

  const usersCollection = mongo.db().collection<UserWithLegacyApiTokens>('users');
  const legacyOwner = await usersCollection.findOne(
    {
      apiTokens: {
        $elemMatch: {
          token: key,
          expiresAt: { $gt: new Date() }
        }
      }
    },
    { projection: { _id: 1 } }
  );

  if (!legacyOwner) {
    return result;
  }

  await ensureLegacyApiTokensMigrated(String(legacyOwner._id));

  result = await auth.api.verifyApiKey({
    body: { key }
  });

  return result;
}
