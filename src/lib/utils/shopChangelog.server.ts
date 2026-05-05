import type { MongoClient } from 'mongodb';
import type {
  Game,
  Shop,
  ShopChangelogAction,
  ShopChangelogEntry,
  ShopChangelogEntryWithUser
} from '$lib/types';
import { nanoid } from 'nanoid';

interface ChangelogUser {
  id: string | null;
  name?: string | null;
  image?: string | null;
}

/**
 * Insert a single shop changelog entry.
 */
export const logShopChange = async (
  client: MongoClient,
  change: {
    shopId: number;
    shopName: string;
    action: ShopChangelogAction;
    user: ChangelogUser;
    fieldInfo: ShopChangelogEntry['fieldInfo'];
    oldValue?: string | null;
    newValue?: string | null;
    metadata?: ShopChangelogEntry['metadata'];
  }
): Promise<void> => {
  const db = client.db();
  const entry: ShopChangelogEntry = {
    id: nanoid(),
    shopId: change.shopId,
    shopName: change.shopName,
    action: change.action,
    fieldInfo: change.fieldInfo,
    oldValue: change.oldValue,
    newValue: change.newValue,
    metadata: change.metadata,
    userId: change.user.id,
    createdAt: new Date()
  };
  await db.collection<ShopChangelogEntry>('shop_changelog').insertOne(entry);
};

const formatValueForComparison = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'boolean') return value.toString();
  return JSON.stringify(value);
};

/**
 * Diff two shop documents and log a changelog entry for every changed field.
 */
export const logShopFieldChanges = async (
  client: MongoClient,
  shopId: number,
  shopName: string,
  oldData: Partial<Shop>,
  newData: Partial<Shop>,
  user: ChangelogUser
): Promise<void> => {
  const fieldsToTrack = ['name', 'comment', 'address', 'openingHours', 'location'] as const;
  const effectiveName = (newData.name ?? shopName).trim();

  for (const field of fieldsToTrack) {
    const oldVal = formatValueForComparison(oldData[field]);
    const newVal = formatValueForComparison(newData[field]);
    if (oldVal === newVal) continue;

    await logShopChange(client, {
      shopId,
      shopName: effectiveName,
      action: 'modified',
      user,
      fieldInfo: { field },
      oldValue: oldVal,
      newValue: newVal
    });
  }
};

/**
 * Diff old and new game arrays, logging added / modified / deleted games.
 */
export const logShopGamesChanges = async (
  client: MongoClient,
  shopId: number,
  shopName: string,
  oldGames: Game[],
  newGames: Game[],
  user: ChangelogUser
): Promise<void> => {
  const oldById = new Map(oldGames.map((g) => [g.gameId, g]));
  const newById = new Map(newGames.map((g) => [g.gameId, g]));

  // Added games
  for (const [gameId, game] of newById) {
    if (!oldById.has(gameId)) {
      await logShopChange(client, {
        shopId,
        shopName,
        action: 'game_added',
        user,
        fieldInfo: { field: 'game', gameId, gameName: game.name, gameVersion: game.version }
      });
    }
  }

  // Deleted games
  for (const [gameId, game] of oldById) {
    if (!newById.has(gameId)) {
      await logShopChange(client, {
        shopId,
        shopName,
        action: 'game_deleted',
        user,
        fieldInfo: { field: 'game', gameId, gameName: game.name, gameVersion: game.version }
      });
    }
  }

  // Modified games (same gameId but different content)
  for (const [gameId, newGame] of newById) {
    const oldGame = oldById.get(gameId);
    if (!oldGame) continue;

    const changed = (['name', 'version', 'comment', 'quantity', 'cost'] as const).some(
      (f) => String(oldGame[f]) !== String(newGame[f])
    );

    if (changed) {
      await logShopChange(client, {
        shopId,
        shopName,
        action: 'game_modified',
        user,
        fieldInfo: { field: 'game', gameId, gameName: newGame.name, gameVersion: newGame.version }
      });
    }
  }
};

/**
 * Fetch changelog entries for a shop with uploader data joined via $lookup.
 */
export const getShopChangelogEntries = async (
  client: MongoClient,
  shopId: number,
  options: { limit?: number; offset?: number } = {}
): Promise<{ entries: ShopChangelogEntryWithUser[]; total: number }> => {
  const { limit = 50, offset = 0 } = options;
  const db = client.db();
  const collection = db.collection<ShopChangelogEntry>('shop_changelog');

  const pipeline = [
    { $match: { shopId } },
    { $sort: { createdAt: -1 } },
    { $skip: offset },
    { $limit: limit },
    {
      $lookup: {
        from: 'users',
        let: { uid: '$userId' },
        pipeline: [
          { $match: { $expr: { $eq: ['$id', '$$uid'] } } },
          { $project: { _id: 0, id: 1, name: 1, displayName: 1, image: 1 } }
        ],
        as: 'userArr'
      }
    },
    {
      $addFields: {
        user: { $arrayElemAt: ['$userArr', 0] }
      }
    },
    { $project: { userArr: 0 } }
  ];

  const [entries, total] = await Promise.all([
    collection.aggregate(pipeline).toArray() as Promise<ShopChangelogEntryWithUser[]>,
    collection.countDocuments({ shopId })
  ]);

  return { entries, total };
};
