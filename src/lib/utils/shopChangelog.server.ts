import type { Filter, MongoClient } from 'mongodb';
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

export interface ShopChangelogViewer {
  id?: string | null;
  userType?: string | null;
}

type MutableShopField = 'name' | 'comment' | 'address' | 'openingHours' | 'location';
type MutableGameField = 'titleId' | 'name' | 'version' | 'comment' | 'quantity' | 'cost';

export interface ShopRollbackPreview {
  shopId: number;
  shopName: string;
  targetEntryId: string | null;
  currentShop: Shop;
  rolledBackShop: Shop;
  appliedEntryIds: string[];
  rollbackEntryCount: number;
}

const mutableShopFields = ['name', 'comment', 'address', 'openingHours', 'location'] as const;
const mutableGameFields = ['titleId', 'name', 'version', 'comment', 'quantity', 'cost'] as const;

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === 'object' && !Array.isArray(value);
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const isMutableShopField = (field: string): field is MutableShopField => {
  return (mutableShopFields as readonly string[]).includes(field);
};

const isMutableGameField = (field: string): field is MutableGameField => {
  return (mutableGameFields as readonly string[]).includes(field);
};

const isGame = (value: unknown): value is Game => {
  if (!isObjectRecord(value)) return false;
  return (
    typeof value.gameId === 'number' &&
    typeof value.titleId === 'number' &&
    typeof value.name === 'string' &&
    typeof value.version === 'string' &&
    typeof value.comment === 'string' &&
    typeof value.quantity === 'number' &&
    typeof value.cost === 'string'
  );
};

const parseStoredValue = (value: string | null | undefined, fallback: unknown = null): unknown => {
  if (value === undefined || value === null) return fallback;
  if (value === 'null') return null;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const coerceGameFieldValue = (field: MutableGameField, value: unknown): Game[MutableGameField] => {
  if (field === 'titleId' || field === 'quantity') {
    const numeric = typeof value === 'number' ? value : Number(value);
    return (Number.isFinite(numeric) ? numeric : 0) as Game[MutableGameField];
  }

  return (typeof value === 'string' ? value : '') as Game[MutableGameField];
};

const isDeletedPhotoEntry = (entry: ShopChangelogEntry): boolean => {
  return entry.action === 'photo_deleted' || entry.action === 'photo_delete_request_approved';
};

const sanitizeDeletedPhotoEntry = (entry: ShopChangelogEntry): ShopChangelogEntry => {
  if (!isDeletedPhotoEntry(entry)) return entry;

  return {
    ...entry,
    fieldInfo: {
      ...entry.fieldInfo,
      photoUrl: null
    }
  };
};

export const canViewDeletedPhotoInChangelog = (
  entry: Pick<ShopChangelogEntry, 'action' | 'userId' | 'fieldInfo' | 'metadata'>,
  viewer?: ShopChangelogViewer | null
): boolean => {
  if (viewer?.userType === 'site_admin') return true;
  if (!viewer?.id) return false;
  if (entry.userId === viewer.id) return true;

  const metadata = entry.metadata;
  if (!isObjectRecord(metadata)) return false;

  return metadata.uploadedBy === viewer.id || metadata.requestedBy === viewer.id;
};

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
  const gameFieldsToTrack = ['titleId', 'name', 'version', 'comment', 'quantity', 'cost'] as const;

  // Added games
  for (const [gameId, game] of newById) {
    if (!oldById.has(gameId)) {
      await logShopChange(client, {
        shopId,
        shopName,
        action: 'game_added',
        user,
        fieldInfo: { field: 'game', gameId, gameName: game.name, gameVersion: game.version },
        metadata: { game: clone(game) }
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
        fieldInfo: { field: 'game', gameId, gameName: game.name, gameVersion: game.version },
        metadata: { game: clone(game) }
      });
    }
  }

  // Modified games (same gameId but different content)
  for (const [gameId, newGame] of newById) {
    const oldGame = oldById.get(gameId);
    if (!oldGame) continue;

    for (const field of gameFieldsToTrack) {
      const oldValue = formatValueForComparison(oldGame[field]);
      const newValue = formatValueForComparison(newGame[field]);
      if (oldValue === newValue) continue;

      await logShopChange(client, {
        shopId,
        shopName,
        action: 'game_modified',
        user,
        fieldInfo: {
          field: `game.${field}`,
          gameId,
          gameName: newGame.name,
          gameVersion: newGame.version
        },
        oldValue,
        newValue
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
  options: { limit?: number; offset?: number; viewer?: ShopChangelogViewer | null } = {}
): Promise<{ entries: ShopChangelogEntryWithUser[]; total: number }> => {
  const { limit = 50, offset = 0, viewer = null } = options;
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

  return {
    entries: entries.map((entry) => {
      if (!isDeletedPhotoEntry(entry) || canViewDeletedPhotoInChangelog(entry, viewer)) {
        return entry;
      }

      return sanitizeDeletedPhotoEntry(entry) as ShopChangelogEntryWithUser;
    }),
    total
  };
};

const getRollbackEntries = async (
  client: MongoClient,
  shopId: number,
  targetEntryId: string | null
): Promise<ShopChangelogEntry[]> => {
  const db = client.db();
  const collection = db.collection<ShopChangelogEntry>('shop_changelog');

  let targetCreatedAt: Date | null = null;
  if (targetEntryId) {
    const targetEntry = await collection.findOne({ shopId, id: targetEntryId });
    if (!targetEntry) {
      throw new Error('Target changelog entry not found');
    }
    targetCreatedAt = new Date(targetEntry.createdAt);
  }

  const filter: Filter<ShopChangelogEntry> = { shopId };
  if (targetCreatedAt) {
    filter.createdAt = { $gt: targetCreatedAt };
  }

  return collection.find(filter).sort({ createdAt: -1 }).toArray();
};

const applyInverseEntry = (shop: Shop, entry: ShopChangelogEntry): boolean => {
  switch (entry.action) {
    case 'modified': {
      const field = entry.fieldInfo.field;
      if (!isMutableShopField(field)) return false;
      (shop as unknown as Record<MutableShopField, unknown>)[field] = parseStoredValue(
        entry.oldValue,
        null
      );
      return true;
    }
    case 'game_modified': {
      const field = entry.fieldInfo.field;
      if (!field.startsWith('game.') || entry.fieldInfo.gameId === undefined) return false;

      const gameField = field.slice('game.'.length);
      if (!isMutableGameField(gameField)) return false;

      const game = shop.games.find((item) => item.gameId === entry.fieldInfo.gameId);
      if (!game) return false;

      (game as unknown as Record<MutableGameField, unknown>)[gameField] = coerceGameFieldValue(
        gameField,
        parseStoredValue(entry.oldValue, null)
      );
      return true;
    }
    case 'game_added': {
      if (entry.fieldInfo.gameId === undefined) return false;
      const originalLength = shop.games.length;
      shop.games = shop.games.filter((game) => game.gameId !== entry.fieldInfo.gameId);
      return shop.games.length !== originalLength;
    }
    case 'game_deleted': {
      const game = entry.metadata?.game;
      if (!isGame(game)) return false;
      if (shop.games.some((item) => item.gameId === game.gameId)) return false;
      shop.games.push(clone(game));
      return true;
    }
    case 'rollback': {
      const oldShop = entry.metadata?.oldShop;
      if (!isObjectRecord(oldShop)) return false;
      Object.assign(shop, clone(oldShop));
      return true;
    }
    default:
      return false;
  }
};

export const buildShopRollbackPreview = async (
  client: MongoClient,
  shopId: number,
  targetEntryId: string | null
): Promise<ShopRollbackPreview> => {
  const db = client.db();
  const shop = await db.collection<Shop>('shops').findOne({ id: shopId });
  if (!shop) {
    throw new Error('Shop not found');
  }

  const rolledBackShop = clone(shop);
  const entries = await getRollbackEntries(client, shopId, targetEntryId);
  const appliedEntryIds: string[] = [];

  for (const entry of entries) {
    if (entry.action === 'rollback') continue;
    if (applyInverseEntry(rolledBackShop, entry)) {
      appliedEntryIds.push(entry.id);
    }
  }

  rolledBackShop.updatedAt = new Date();

  return {
    shopId,
    shopName: rolledBackShop.name,
    targetEntryId,
    currentShop: shop,
    rolledBackShop,
    appliedEntryIds,
    rollbackEntryCount: entries.length
  };
};

export const applyShopRollback = async (
  client: MongoClient,
  shopId: number,
  targetEntryId: string | null,
  user: ChangelogUser
): Promise<ShopRollbackPreview> => {
  const preview = await buildShopRollbackPreview(client, shopId, targetEntryId);
  const db = client.db();

  await db.collection<Shop>('shops').updateOne(
    { id: shopId },
    {
      $set: {
        name: preview.rolledBackShop.name,
        comment: preview.rolledBackShop.comment,
        address: preview.rolledBackShop.address,
        openingHours: preview.rolledBackShop.openingHours,
        location: preview.rolledBackShop.location,
        games: preview.rolledBackShop.games,
        updatedAt: preview.rolledBackShop.updatedAt
      }
    }
  );

  await logShopChange(client, {
    shopId,
    shopName: preview.rolledBackShop.name,
    action: 'rollback',
    user,
    fieldInfo: { field: 'changelog' },
    metadata: {
      targetEntryId,
      appliedEntryIds: preview.appliedEntryIds,
      rollbackEntryCount: preview.rollbackEntryCount,
      oldShop: preview.currentShop,
      newShop: preview.rolledBackShop
    }
  });

  return preview;
};
