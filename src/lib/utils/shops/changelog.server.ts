import type { Document, Filter, MongoClient, ObjectId } from 'mongodb';
import type {
  Game,
  Shop,
  ShopChangelogEntry,
  ShopChangelogEntryWithUser,
  StoredImageAsset
} from '$lib/types';
import type { ShopChangelogAction } from '$lib/types/index.server';
import { nanoid } from 'nanoid';
import { resolveShopAddress } from '$lib/utils/region.server';
import { syncShopDocument } from '$lib/db/meili.server';
import { reassignShopTransitInBackground } from '$lib/openmetro/assign.server';
import { auditUgc, type UgcAuditBlock } from '$lib/ugc/audit.server';
import { submitUgc } from '$lib/ugc/entries.server';
import { shopUgcTexts } from '$lib/ugc/shop-fields.server';
import { deleteFile } from '$lib/oss/index';
import { notify } from '$lib/notifications/index.server';
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
  /** Distinct authors of the reverted entries (the notify option targets these). */
  authors: ShopRollbackAuthor[];
  /** Photos uploaded within the rollback window — removable via `removePhotos`. */
  photos: ShopRollbackPhotoTarget[];
}

/** What happens to the rolled-back changelog entries. */
export type ShopRollbackRetention = 'keep' | 'purge';

export interface ShopRollbackOptions {
  /** Default `keep`: the ledger stays intact and fully reconstructible. */
  retention?: ShopRollbackRetention;
  /** Delete photos uploaded within the rollback window (OSS object + record). */
  removePhotos?: boolean;
  /** Send a SYSTEM notice to each affected author, optionally with a custom message. */
  notify?: { enabled?: boolean; message?: string };
}

export interface ShopRollbackPhotoTarget {
  photoId: string;
  photoUrl: string | null;
  uploadedBy: string | null;
}

export interface ShopRollbackAuthor {
  id: string;
  name: string | null;
}

export interface ShopRollbackResult extends ShopRollbackPreview {
  /** Retention mode that was applied. */
  retention: ShopRollbackRetention;
  /** Photo ids actually removed (empty when `removePhotos` was off). */
  removedPhotoIds: string[];
  /** `photo_uploaded` entries for those photos — the affected set the
   *  highlight overlay needs, since photos are never in `appliedEntryIds`. */
  removedPhotoEntryIds: string[];
  /** Photos whose stored object (or DB record) could not be deleted. The photo
   *  leaves the shop, but the stored file may still exist upstream. */
  failedPhotoIds: string[];
  /** Authors the SYSTEM notice was sent to (empty when notify was off). */
  notifiedUserIds: string[];
  /** Whether the private reversal snapshot was persisted (always false under `purge`). */
  snapshotStored: boolean;
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
 * Private reversal snapshots for rollback changelog entries. The public
 * `shop_changelog` ledger must never carry full shop documents — its entries
 * (including metadata) are readable by anyone — so `applyShopRollback` stores
 * the pre-rollback shop verbatim here, keyed by the rollback entry's id, and
 * only the reversal path in this module reads it back. Never exposed through
 * any API route or search index.
 */
const SNAPSHOTS_COLLECTION = 'shop_changelog_snapshots';

interface ShopChangelogSnapshotRecord {
  _id?: ObjectId;
  entryId: string;
  shopId: number;
  /** The verbatim pre-rollback shop document. */
  snapshot: Shop;
  createdAt: Date;
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
    createdAt?: Date;
    /** Pre-generated entry id — lets callers reference the entry (e.g. its
     * reversal snapshot) before it is inserted. Random nanoid when omitted. */
    id?: string;
  }
): Promise<void> => {
  const db = client.db();
  const entry: ShopChangelogEntry = {
    id: change.id ?? nanoid(),
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
    { $sort: { createdAt: -1, _id: -1 } },
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
    { $sort: { createdAt: -1, _id: -1 } },
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

/** Fetch the entries a rollback to `targetEntryId` reverts: everything
 * recorded strictly AFTER the target. "As of the target entry" semantics —
 * the target's own change stays part of the reconstructed state, so the
 * rollback lands on exactly what the time-point preview shows. The cut is
 * pure-timestamp on purpose: a multi-field edit logs one entry per field,
 * often within the same millisecond, and the shop document was updated
 * atomically — splitting a group by insertion order would reconstruct a
 * mid-edit state that never existed. */
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

  const filter: Filter<ShopChangelogEntry> = {
    shopId,
    ...(targetCreatedAt ? { createdAt: { $gt: targetCreatedAt } } : {})
  };

  // `_id` as the tiebreaker keeps same-millisecond groups in a deterministic
  // (reverse insertion) order; members touch disjoint fields, so the order
  // never changes the outcome.
  return collection.find(filter).sort({ createdAt: -1, _id: -1 }).toArray();
};

/** Defensive guard for the inverse replay: an entry carrying neither value
 * key would write null/'' into the fields it once touched if applied.
 * Original writers always store at least one of the two keys (null when a
 * field was previously unset), so their absence means the values were
 * stripped out-of-band. The redact retention that used to produce such
 * entries was removed before any deployment, so none should exist — skip
 * rather than corrupt state if stray data ever appears. */
const isRedactedEntry = (entry: ShopChangelogEntry): boolean =>
  (entry.action === 'modified' || entry.action === 'game_modified') &&
  !('oldValue' in entry) &&
  !('newValue' in entry);

const applyInverseEntry = (
  shop: Shop,
  entry: ShopChangelogEntry,
  snapshots: Map<string, Shop>
): boolean => {
  switch (entry.action) {
    case 'created':
      return false;
    case 'modified': {
      if (isRedactedEntry(entry)) return false;
      const field = entry.fieldInfo.field;
      if (!isMutableShopField(field)) return false;
      (shop as unknown as Record<MutableShopField, unknown>)[field] = parseStoredValue(
        entry.oldValue,
        null
      );
      return true;
    }
    case 'game_modified': {
      if (isRedactedEntry(entry)) return false;
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
      // A rollback changelog entry is itself reversible: restoring its
      // pre-rollback snapshot (stored privately in shop_changelog_snapshots)
      // brings the shop back to the state it had immediately before that
      // rollback. Entries whose snapshot is unavailable — purged, lost, or
      // the public preview path, which never reads private data — are
      // skipped; the reverted entries themselves still reconstruct those
      // time points from the public ledger where retention allows.
      return applyShopSnapshot(shop, snapshots.get(entry.id));
    }
    default:
      return false;
  }
};

/** Batch-fetch the reversal snapshots for the rollback entries in a window.
 * `includeInlineLegacy` opts into the pre-migration inline `metadata.oldShop`
 * fallback — admin-only: the public time-point preview must never read it,
 * because a legacy snapshot can carry content that a purge-style removal
 * scrubbed from the public ledger. */
const getReversalSnapshots = async (
  client: MongoClient,
  entries: ShopChangelogEntry[],
  options: { includeInlineLegacy?: boolean } = {}
): Promise<Map<string, Shop>> => {
  const rollbackEntryIds = entries
    .filter((entry) => entry.action === 'rollback')
    .map((entry) => entry.id);
  if (rollbackEntryIds.length === 0) return new Map();

  const docs = await client
    .db()
    .collection<ShopChangelogSnapshotRecord>(SNAPSHOTS_COLLECTION)
    .find({ entryId: { $in: rollbackEntryIds } })
    .toArray();
  const snapshots = new Map(docs.map((doc) => [doc.entryId, doc.snapshot]));

  if (options.includeInlineLegacy) {
    for (const entry of entries) {
      if (
        entry.action === 'rollback' &&
        !snapshots.has(entry.id) &&
        isObjectRecord(entry.metadata) &&
        isObjectRecord(entry.metadata.oldShop)
      ) {
        snapshots.set(entry.id, entry.metadata.oldShop as Shop);
      }
    }
  }
  return snapshots;
};

/** Photos uploaded within the rollback window (revertible via `removePhotos`). */
const collectWindowPhotos = (entries: ShopChangelogEntry[]): ShopRollbackPhotoTarget[] =>
  entries
    .filter((entry) => entry.action === 'photo_uploaded' && entry.fieldInfo.photoId)
    .map((entry) => ({
      photoId: entry.fieldInfo.photoId as string,
      photoUrl: entry.fieldInfo.photoUrl ?? null,
      uploadedBy: entry.userId ?? null
    }));

/** Distinct named authors of the given entries, preserving first-seen order. */
const collectAuthors = async (
  client: MongoClient,
  entries: ShopChangelogEntry[]
): Promise<ShopRollbackAuthor[]> => {
  const ids = [...new Set(entries.map((entry) => entry.userId).filter((id): id is string => !!id))];
  if (ids.length === 0) return [];

  const users = await client
    .db()
    .collection<{ id: string; name?: string | null }>('users')
    .find({ id: { $in: ids } }, { projection: { _id: 0, id: 1, name: 1 } })
    .toArray();
  const nameById = new Map(users.map((user) => [user.id, user.name ?? null]));

  return ids.map((id) => ({ id, name: nameById.get(id) ?? null }));
};

/** The state a rollback to `targetEntryId` restores: the shop as it stood at
 * that entry (the entry's own change kept), computed by reverting every
 * entry recorded after it. Shared by the admin rollback and the public
 * time-point preview so both land on the identical state. */
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
  const snapshots = await getReversalSnapshots(client, entries, { includeInlineLegacy: true });
  const appliedEntryIds: string[] = [];

  for (const entry of entries) {
    if (applyInverseEntry(rolledBackShop, entry, snapshots)) {
      appliedEntryIds.push(entry.id);
    }
  }

  rolledBackShop.updatedAt = new Date();

  const authors = await collectAuthors(
    client,
    entries.filter((entry) => appliedEntryIds.includes(entry.id))
  );

  return {
    shopId,
    shopName: rolledBackShop.name,
    targetEntryId,
    currentShop: shop,
    rolledBackShop,
    appliedEntryIds,
    authors,
    photos: collectWindowPhotos(entries)
  };
};

export interface ShopTimePointPreview {
  shopId: number;
  shopName: string;
  targetEntryId: string;
  targetEntryCreatedAt: Date;
  /** Reconstructed stored-shape shop document at the target entry. */
  shop: Shop;
  appliedEntryIds: string[];
  entryCount: number;
  authors: ShopRollbackAuthor[];
  photos: ShopRollbackPhotoTarget[];
}

/**
 * Reconstruct the shop as it stood at a changelog entry for the *public*
 * time-point preview — the entry's own change is part of the state, matching
 * what a rollback to it restores. Same inverse replay as the rollback
 * preview, but built exclusively from public ledger data: private reversal
 * snapshots (and their legacy inline copies) are never consulted, so a
 * rollback entry without an accessible snapshot is simply skipped — content
 * that retention scrubbed from the ledger cannot resurface here, and purged
 * entries degrade to the post-rollback values instead.
 */
export const buildShopTimePointPreview = async (
  client: MongoClient,
  shopId: number,
  targetEntryId: string
): Promise<ShopTimePointPreview> => {
  const db = client.db();
  const shop = await db.collection<Shop>('shops').findOne({ id: shopId });
  if (!shop) {
    throw new Error('Shop not found');
  }

  // The target itself is not part of the revert window — fetch it for its
  // timestamp (the previewed state's `updatedAt`).
  const targetEntry = await db
    .collection<ShopChangelogEntry>('shop_changelog')
    .findOne({ shopId, id: targetEntryId });
  if (!targetEntry) {
    throw new Error('Target changelog entry not found');
  }

  const entries = await getRollbackEntries(client, shopId, targetEntryId);

  const snapshots = await getReversalSnapshots(client, entries);
  const appliedEntryIds: string[] = [];
  for (const entry of entries) {
    if (applyInverseEntry(shop, entry, snapshots)) {
      appliedEntryIds.push(entry.id);
    }
  }
  shop.updatedAt = targetEntry.createdAt;

  const authors = await collectAuthors(
    client,
    entries.filter((entry) => appliedEntryIds.includes(entry.id))
  );

  return {
    shopId,
    shopName: shop.name,
    targetEntryId,
    targetEntryCreatedAt: new Date(targetEntry.createdAt),
    shop,
    appliedEntryIds,
    entryCount: entries.length,
    authors,
    photos: collectWindowPhotos(entries)
  };
};

/** Send the rollback SYSTEM notice to each affected author. Best-effort and
 * always delivered (`notify` treats SYSTEM as platform-generated), speaking
 * as the official account; the optional custom message rides the `content`
 * slot that NotificationItem renders as a quoted line. */
const notifyRollbackAuthors = async (
  recipients: ShopRollbackAuthor[],
  context: { shopId: number; shopName: string; message?: string; reviewedBy: string | null }
): Promise<string[]> => {
  const notified: string[] = [];
  for (const author of recipients) {
    try {
      await notify({
        type: 'SYSTEM',
        actorUserId: 'system',
        actorName: 'nearcade',
        targetUserId: author.id,
        noticeKind: 'rollback',
        kind: 'shop',
        refId: String(context.shopId),
        shopId: context.shopId,
        shopName: context.shopName,
        ...(context.message ? { content: context.message } : {}),
        ...(context.reviewedBy ? { reviewedBy: context.reviewedBy } : {})
      });
      notified.push(author.id);
    } catch (err) {
      console.error(`Failed to notify rolled-back author ${author.id}:`, err);
    }
  }
  return notified;
};

export const applyShopRollback = async (
  client: MongoClient,
  shopId: number,
  targetEntryId: string | null,
  user: ChangelogUser,
  options: ShopRollbackOptions = {}
): Promise<ShopRollbackResult> => {
  const retention = options.retention ?? 'keep';
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

  // The rollback entry is referenced by its reversal snapshot, so its id is
  // generated up front and the snapshot is written first (both best-effort —
  // the whole rollback flow is sequential best-effort, no transactions).
  const rollbackEntryId = nanoid();

  let snapshotStored = false;
  if (retention !== 'purge') {
    // `purge` skips the snapshot on purpose: the pre-rollback state IS the
    // prohibited content being erased, and a rollback of it should not be
    // reversible. `keep` retains it privately for reversibility.
    try {
      await db.collection<ShopChangelogSnapshotRecord>(SNAPSHOTS_COLLECTION).insertOne({
        entryId: rollbackEntryId,
        shopId,
        snapshot: preview.currentShop,
        createdAt: new Date()
      });
      snapshotStored = true;
    } catch (err) {
      console.error('Failed to store rollback reversal snapshot:', err);
    }
  }

  // Retention of the rolled-back ledger entries. `keep` leaves the window
  // untouched (history stays public and fully reconstructible); `purge`
  // hard-deletes the reverted entries for erasure incidents. Photo entries are
  // never "applied" by the inverse replay — photos live in `images`, not in the
  // shop document — so they are not part of this set at all; the photo removal
  // below owns their ledger treatment, under either retention mode.
  if (retention === 'purge' && preview.appliedEntryIds.length > 0) {
    try {
      await db
        .collection<ShopChangelogEntry>('shop_changelog')
        .deleteMany({ shopId, id: { $in: preview.appliedEntryIds } });
    } catch (err) {
      console.error('Failed to purge rolled-back entries:', err);
    }
  }

  // Photo removal: every photo uploaded inside the rollback window is deleted
  // from object storage and the `images` collection (same as the admin photo
  // delete path). Best-effort per photo.
  //
  // No `photo_deleted` entry is written, under either retention mode. A
  // rollback is one ledger event, and splitting it into a rollback card plus a
  // run of photo rows made a single operation read as several unrelated ones.
  // Worse, those rows could never join the card's highlight overlay: they are
  // not in `appliedEntryIds` (photos never are — see the retention pass above),
  // so hovering the card lit up the reverted field entries while the photo
  // removals sitting immediately below it stayed unlit. The notice also carried
  // the photo URL, which `ShopChangelogView` renders as a thumbnail and
  // `canViewDeletedPhotoInChangelog` hands to site admins and to the original
  // uploader. The rollback entry below reports the count instead, and under
  // `keep` the retained upload entries still record who uploaded what.
  const removedPhotoIds: string[] = [];
  // Photos whose stored object could not be deleted — a provider outage, or a
  // photo uploaded under a provider this deployment holds no credentials for.
  // The record is still dropped so the photo leaves the shop, but the caller
  // has to be able to see that the erasure was only partial.
  const failedPhotoIds: string[] = [];
  // Ids of the `photo_uploaded` ledger entries for the photos this rollback
  // erased. They can never appear in `appliedEntryIds` (photos are not part of
  // the shop document, so the inverse replay rejects them), which left the
  // rollback's photo effect invisible to the changelog highlight overlay —
  // hovering a photo-only rollback highlighted nothing at all. Recording them
  // separately is what lets the card own its full affected set.
  let removedPhotoEntryIds: string[] = [];
  if (options.removePhotos && preview.photos.length > 0) {
    const photosCollection = db.collection<StoredImageAsset>('images');
    for (const photo of preview.photos) {
      const doc = await photosCollection.findOne({ id: photo.photoId, shopId }).catch((err) => {
        console.error(`Failed to look up photo ${photo.photoId} during rollback:`, err);
        return null;
      });
      if (!doc) continue;

      // Storage deletion is best-effort and must NOT gate the record deletion.
      // Coupling the two inside one try/catch meant a single provider error
      // skipped the photo entirely — it stayed live on the shop, its upload
      // entry stayed intact, and the rollback still reported success with a
      // zero photo count, which is how a broken erasure looked like a no-op.
      try {
        await deleteFile(doc);
      } catch (err) {
        failedPhotoIds.push(photo.photoId);
        console.error(`Failed to delete stored file for photo ${photo.photoId}:`, err);
      }

      try {
        await photosCollection.deleteOne({ id: photo.photoId, shopId });
        removedPhotoIds.push(photo.photoId);
      } catch (err) {
        failedPhotoIds.push(photo.photoId);
        console.error(`Failed to remove photo record ${photo.photoId} during rollback:`, err);
      }
    }

    // The retention modes differ only in whether the upload entries survive:
    // `keep` retains them as audit trail minus the now-dead URL, `purge` erases
    // them outright. Photos still on the shop are never touched — their entry
    // truthfully records a photo the page still shows.
    if (removedPhotoIds.length > 0) {
      try {
        const uploadEntries = await db
          .collection<ShopChangelogEntry>('shop_changelog')
          .find(
            {
              shopId,
              action: 'photo_uploaded',
              'fieldInfo.photoId': { $in: removedPhotoIds }
            },
            { projection: { _id: 0, id: 1 } }
          )
          .toArray();
        removedPhotoEntryIds = uploadEntries.map((entry) => entry.id);

        if (retention === 'purge') {
          if (removedPhotoEntryIds.length > 0) {
            await db
              .collection<ShopChangelogEntry>('shop_changelog')
              .deleteMany({ shopId, id: { $in: removedPhotoEntryIds } });
          }
        } else {
          await db.collection<ShopChangelogEntry>('shop_changelog').updateMany(
            {
              shopId,
              action: 'photo_uploaded',
              'fieldInfo.photoId': { $in: removedPhotoIds }
            },
            { $unset: { 'fieldInfo.photoUrl': '' } }
          );
        }
      } catch (err) {
        console.error('Failed to reconcile removed photos in changelog entries:', err);
      }
    }
  }

  await logShopChange(client, {
    id: rollbackEntryId,
    shopId,
    shopName: preview.rolledBackShop.name,
    action: 'rollback',
    user,
    fieldInfo: { field: 'changelog' },
    metadata: {
      targetEntryId,
      appliedEntryIds: preview.appliedEntryIds,
      ...(removedPhotoEntryIds.length > 0 ? { removedPhotoEntryIds } : {}),
      retention,
      snapshotStored,
      removedPhotoCount: removedPhotoIds.length
    }
  });

  // Authors of the reverted changes plus uploaders of removed photos — the
  // acting admin is never notified about their own action.
  const recipientIds = new Set<string>();
  for (const author of preview.authors) recipientIds.add(author.id);
  for (const photo of preview.photos) {
    if (photo.uploadedBy && removedPhotoIds.includes(photo.photoId)) {
      recipientIds.add(photo.uploadedBy);
    }
  }
  recipientIds.delete(user.id ?? '');

  const notifiedUserIds = options.notify?.enabled
    ? await notifyRollbackAuthors(
        [...recipientIds].map((id) => ({
          id,
          name: preview.authors.find((author) => author.id === id)?.name ?? null
        })),
        {
          shopId,
          shopName: preview.rolledBackShop.name,
          message: options.notify?.message?.trim() || undefined,
          reviewedBy: user.id
        }
      )
    : [];

  return {
    ...preview,
    retention,
    removedPhotoIds,
    removedPhotoEntryIds,
    failedPhotoIds,
    notifiedUserIds,
    snapshotStored
  };
};
