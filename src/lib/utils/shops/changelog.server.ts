import type { Document, Filter, MongoClient } from 'mongodb';
import type {
  Game,
  Shop,
  ShopChangelogAction,
  ShopChangelogEntry,
  ShopChangelogEntryWithUser
} from '$lib/types';
import { nanoid } from 'nanoid';
import { resolveShopAddress } from '$lib/utils/region.server';
import { syncShopDocument } from '$lib/db/meili.server';
import { reassignShopTransitInBackground } from '$lib/openmetro/assign.server';
import { auditUgc, type UgcAuditBlock } from '$lib/ugc/audit.server';
import { submitUgc } from '$lib/ugc/entries.server';
import { shopUgcTexts } from '$lib/ugc/shop-fields.server';
import { escapeRegex, userLookupStages, USER_LABEL_EXPRESSION } from './query.server';

interface ChangelogUser {
  id: string | null;
  name?: string | null;
  image?: string | null;
}

/** Thrown by `applyShopRollback` when the rolled-back text fails the UGC
 * moderation gate — routes map it to the localized rejection message. */
export class UgcBlockedError extends Error {
  constructor(readonly block: UgcAuditBlock) {
    super('ugc_blocked');
  }
}

export interface ShopChangelogViewer {
  id?: string | null;
  userType?: string | null;
}

type MutableShopField =
  'name' | 'comment' | 'address' | 'openingHours' | 'location' | 'isClosed' | 'closedReason';
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

const mutableShopFields = [
  'name',
  'comment',
  'address',
  'openingHours',
  'location',
  'isClosed',
  'closedReason'
] as const;
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

const applyShopSnapshot = (shop: Shop, snapshot: unknown): boolean => {
  if (!isObjectRecord(snapshot)) return false;

  Object.assign(shop, clone(snapshot));
  return true;
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
    createdAt?: Date;
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
    userId: change.user.id,
    createdAt: change.createdAt ?? new Date(),
    ...(change.metadata === undefined ? {} : { metadata: change.metadata })
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
  const fieldsToTrack = mutableShopFields;
  const effectiveName = (newData.name ?? shopName).trim();

  for (const field of fieldsToTrack) {
    // Skip fields not present in newData — they were not part of this update.
    if (!(field in newData)) continue;
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
 * Shared aggregation stages that resolve an entry's `userId` into the author
 * document stored as `entry.user`. Kept in one place so every changelog reader
 * projects the same shape.
 */
const USER_LOOKUP_STAGES: Document[] = userLookupStages('userId');

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
    ...USER_LOOKUP_STAGES
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

/**
 * Fetch the most recent shop changelog entries across the entire site,
 * with uploader data joined via $lookup.
 */
export const getRecentShopChangelogEntries = async (
  client: MongoClient,
  options: { limit?: number; offset?: number; viewer?: ShopChangelogViewer | null } = {}
): Promise<{ entries: ShopChangelogEntryWithUser[]; total: number }> => {
  const { limit = 20, offset = 0, viewer = null } = options;
  const db = client.db();
  const collection = db.collection<ShopChangelogEntry>('shop_changelog');

  const pipeline = [
    { $sort: { createdAt: -1 } },
    { $skip: offset },
    { $limit: limit },
    ...USER_LOOKUP_STAGES
  ];

  const [entries, total] = await Promise.all([
    collection.aggregate(pipeline).toArray() as Promise<ShopChangelogEntryWithUser[]>,
    collection.estimatedDocumentCount()
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

// ---------------------------------------------------------------------------
// Admin changelog browser
//
// Site-wide, searchable, filterable view over the whole `shop_changelog`
// ledger. The public per-shop reader above stays deliberately simple; this
// section exists only for the admin console and is never called from
// user-facing routes.
// ---------------------------------------------------------------------------

export interface ShopChangelogSearchQuery {
  /** Free text matched against shop name, field, game, old/new value and actor id. */
  search?: string;
  action?: string;
  /** Exact `fieldInfo.field` value, e.g. `name` or `game.cost`. */
  field?: string;
  userId?: string;
  shopId?: number;
  /** Inclusive lower bound on `createdAt`. */
  from?: Date | null;
  /** Inclusive upper bound on `createdAt`. */
  to?: Date | null;
  limit?: number;
  offset?: number;
}

/**
 * Build the Mongo match document for a changelog search.
 *
 * `search` is an `$or` across the fields an admin would plausibly type into the
 * search box; every other key is an exact-equality narrowing filter.
 */
export const buildShopChangelogMatch = (
  query: ShopChangelogSearchQuery
): Filter<ShopChangelogEntry> => {
  const match: Filter<ShopChangelogEntry> = {};

  const search = query.search?.trim();
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    match.$or = [
      { shopName: rx },
      { 'fieldInfo.field': rx },
      { 'fieldInfo.gameName': rx },
      { 'fieldInfo.gameVersion': rx },
      { oldValue: rx },
      { newValue: rx },
      { userId: rx },
      { action: rx }
    ];
  }

  if (query.action && query.action !== 'all') {
    match.action = query.action as ShopChangelogAction;
  }
  if (query.field) {
    (match as Record<string, unknown>)['fieldInfo.field'] = query.field;
  }
  if (query.userId) {
    match.userId = query.userId;
  }
  if (typeof query.shopId === 'number' && Number.isFinite(query.shopId)) {
    match.shopId = query.shopId;
  }
  if (query.from || query.to) {
    match.createdAt = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lte: query.to } : {})
    };
  }

  return match;
};

/** Hide photos the viewer is not allowed to see, matching the public reader. */
const projectForViewer = (
  entries: ShopChangelogEntryWithUser[],
  viewer: ShopChangelogViewer | null
): ShopChangelogEntryWithUser[] =>
  entries.map((entry) => {
    if (!isDeletedPhotoEntry(entry) || canViewDeletedPhotoInChangelog(entry, viewer)) {
      return entry;
    }
    return sanitizeDeletedPhotoEntry(entry) as ShopChangelogEntryWithUser;
  });

/**
 * Site-wide changelog search: newest first, with the author joined in.
 * Returns the matching row count so callers can size their pagination.
 */
export const searchShopChangelogEntries = async (
  client: MongoClient,
  query: ShopChangelogSearchQuery,
  viewer: ShopChangelogViewer | null = null
): Promise<{ entries: ShopChangelogEntryWithUser[]; total: number }> => {
  const { limit = 20, offset = 0 } = query;
  const db = client.db();
  const collection = db.collection<ShopChangelogEntry>('shop_changelog');
  const match = buildShopChangelogMatch(query);

  const pipeline = [
    { $match: match },
    { $sort: { createdAt: -1, id: 1 } },
    { $skip: offset },
    { $limit: limit },
    ...USER_LOOKUP_STAGES
  ];

  const [entries, total] = await Promise.all([
    collection.aggregate(pipeline).toArray() as Promise<ShopChangelogEntryWithUser[]>,
    collection.countDocuments(match)
  ]);

  return { entries: projectForViewer(entries, viewer), total };
};

export interface ShopChangelogFacet {
  value: string;
  count: number;
}

export interface ShopChangelogUserFacet extends ShopChangelogFacet {
  userId: string;
  /** Pre-formatted, language-neutral author label (`Display Name` or `@handle`). */
  label: string;
}

export interface ShopChangelogFacets {
  actions: ShopChangelogFacet[];
  fields: ShopChangelogFacet[];
  users: ShopChangelogUserFacet[];
  /** Distinct shops present in the searched scope. */
  shopCount: number;
  /** Newest / oldest timestamps present in the searched scope. */
  newest: Date | null;
  oldest: Date | null;
}

/** Upper bounds for the facet dropdowns, so the option lists stay usable. */
const FACET_LIMITS = { actions: 40, fields: 80, users: 60 } as const;

/**
 * Filter options for the admin changelog browser, computed in a single pass
 * with `$facet`.
 *
 * Facets intentionally ignore the action / field / actor / date narrowing and
 * are derived from the free-text scope only. That keeps the dropdowns stable
 * while an admin drills in — excluding the dimension being filtered would make
 * the other options collapse to zero the moment a filter is applied.
 */
export const getShopChangelogFacets = async (
  client: MongoClient,
  query: Pick<ShopChangelogSearchQuery, 'search' | 'shopId'>
): Promise<ShopChangelogFacets> => {
  const db = client.db();
  const collection = db.collection<ShopChangelogEntry>('shop_changelog');
  const match = buildShopChangelogMatch(query);

  const [result] = await collection
    .aggregate([
      { $match: match },
      {
        $facet: {
          actions: [
            { $group: { _id: '$action', count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } },
            { $limit: FACET_LIMITS.actions }
          ],
          fields: [
            { $group: { _id: '$fieldInfo.field', count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } },
            { $limit: FACET_LIMITS.fields }
          ],
          users: [
            { $group: { _id: '$userId', count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } },
            { $limit: FACET_LIMITS.users },
            {
              $lookup: {
                from: 'users',
                let: { uid: '$_id' },
                pipeline: [
                  { $match: { $expr: { $eq: ['$id', '$$uid'] } } },
                  { $project: { _id: 0, id: 1, name: 1, displayName: 1 } }
                ],
                as: 'author'
              }
            },
            {
              $addFields: {
                author: { $arrayElemAt: ['$author', 0] }
              }
            },
            {
              // Mirror getDisplayName: prefer the display name, fall back to
              // `@handle`, and treat a name equal to the id as "no handle".
              $project: {
                _id: 0,
                count: 1,
                userId: '$_id',
                label: USER_LABEL_EXPRESSION
              }
            }
          ],
          shops: [{ $group: { _id: '$shopId' } }, { $count: 'total' }],
          range: [
            {
              $group: {
                _id: null,
                newest: { $max: '$createdAt' },
                oldest: { $min: '$createdAt' }
              }
            }
          ]
        }
      }
    ])
    .toArray();

  const toFacets = (rows: Array<{ _id: string | null; count: number }>): ShopChangelogFacet[] =>
    rows
      .filter((row) => typeof row._id === 'string' && row._id.length > 0)
      .map((row) => ({ value: row._id as string, count: row.count }));

  const users: ShopChangelogUserFacet[] = (
    (result?.users ?? []) as Array<{
      userId: string | null;
      count: number;
      label: string | null;
    }>
  )
    .filter((row) => typeof row.userId === 'string' && row.userId.length > 0)
    .map((row) => ({
      value: row.userId as string,
      userId: row.userId as string,
      count: row.count,
      label: row.label || (row.userId as string)
    }));

  const shopCount = ((result?.shops ?? [])[0] as { total?: number } | undefined)?.total ?? 0;

  const range = (result?.range ?? [])[0] as
    { newest?: Date | null; oldest?: Date | null } | undefined;

  return {
    actions: toFacets((result?.actions ?? []) as Array<{ _id: string | null; count: number }>),
    fields: toFacets((result?.fields ?? []) as Array<{ _id: string | null; count: number }>),
    users,
    shopCount,
    newest: range?.newest ?? null,
    oldest: range?.oldest ?? null
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
    filter.createdAt = { $gte: targetCreatedAt };
  }

  return collection.find(filter).sort({ createdAt: -1 }).toArray();
};

const applyInverseEntry = (shop: Shop, entry: ShopChangelogEntry): boolean => {
  switch (entry.action) {
    case 'created':
      return false;
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
      // A rollback changelog entry is itself reversible: restoring its pre-rollback
      // snapshot brings the shop back to the state it had immediately before that rollback.
      return applyShopSnapshot(shop, entry.metadata?.oldShop);
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
  const storedRegion = preview.rolledBackShop.address.region;
  const region = Array.isArray(storedRegion) ? storedRegion : undefined;
  const address = await resolveShopAddress({
    general: preview.rolledBackShop.address.general ?? [],
    detailed: preview.rolledBackShop.address.detailed ?? '',
    region,
    coordinates: preview.rolledBackShop.location?.coordinates ?? null
  });

  if (address.region.length === 0) {
    throw new Error('Shop rollback address has no valid terminal region');
  }

  preview.rolledBackShop.address = address;

  // Same moderation gate as the shop edit path: rolled-back text must not
  // bypass Tier-0, and never-judged text must reach the LLM judge queue.
  const blocked = await auditUgc('shop', shopId, shopUgcTexts(preview.rolledBackShop));
  if (blocked) {
    throw new UgcBlockedError(blocked);
  }

  const rollbackSet: Record<string, unknown> = {
    name: preview.rolledBackShop.name,
    comment: preview.rolledBackShop.comment,
    address: preview.rolledBackShop.address,
    openingHours: preview.rolledBackShop.openingHours,
    location: preview.rolledBackShop.location,
    games: preview.rolledBackShop.games,
    updatedAt: preview.rolledBackShop.updatedAt
  };
  const rollbackUnset: Record<string, ''> = {};

  if (typeof preview.rolledBackShop.isClosed === 'boolean') {
    rollbackSet.isClosed = preview.rolledBackShop.isClosed;
  } else {
    rollbackUnset.isClosed = '';
  }

  if (preview.rolledBackShop.closedReason) {
    rollbackSet.closedReason = preview.rolledBackShop.closedReason;
  } else {
    rollbackUnset.closedReason = '';
  }

  await db.collection<Shop>('shops').updateOne(
    { id: shopId },
    {
      $set: rollbackSet,
      ...(Object.keys(rollbackUnset).length > 0 ? { $unset: rollbackUnset } : {})
    }
  );

  // Re-register the rolled-back fields so content-addressed moderation state
  // follows the restore: without this, text that was removed by moderation
  // would come back through the rollback unnoticed by the UGC registry.
  submitUgc(
    'shop',
    shopId,
    user.id ? { id: user.id, name: user.name ?? null } : null,
    shopUgcTexts(preview.rolledBackShop)
  );

  try {
    const rolledBackShop = await db.collection<Shop>('shops').findOne({ id: shopId });
    if (rolledBackShop) {
      await syncShopDocument(rolledBackShop);
    }
  } catch (meiliErr) {
    console.error('Failed to sync rolled-back shop to Meilisearch:', meiliErr);
  }

  // A rollback can restore a previous location: reassign the metro station
  // so `transit.metro` follows the restored coordinates (non-fatal).
  reassignShopTransitInBackground(client, shopId);

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
