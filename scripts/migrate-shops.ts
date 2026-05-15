#!/usr/bin/env tsx
/**
 * Shop data migration script.
 *
 * This script performs all shop-schema migrations in one pass:
 * - removes legacy ShopSource usage from shops and shop references
 * - normalizes openingHours to object pairs ({ hour, minute })
 * - normalizes games to remove legacy id fields and recompute deterministic gameId
 *
 * Final gameId rule:
 *   gameId = shopId * 1000 + index
 * where index is assigned after sorting by (titleId, name, version).
 */

import {
  MongoClient,
  type AnyBulkWriteOperation,
  type Collection,
  type Document,
  type ObjectId,
  type WithId
} from 'mongodb';
import dotenv from 'dotenv';

if (!('MONGODB_URI' in process.env)) {
  dotenv.config();
}

const MONGODB_URI = process.env.MONGODB_URI;

const OFFSET_BEMANICN = 10000;
const OFFSET_ZIV = 20000;

const DRY_RUN = process.argv.includes('--dry-run');

type LegacyShopSource = 'bemanicn' | 'ziv' | 'nearcade';

type LegacyShopRef = {
  source?: unknown;
  id?: unknown;
};

type ShopDoc = WithId<Document> & {
  id?: unknown;
  source?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  openingHours?: unknown;
  games?: unknown;
};

type OpeningHourTime = {
  hour: number;
  minute: number;
};

type OpeningHourPair = [OpeningHourTime, OpeningHourTime];

const normalizeSource = (source: unknown): LegacyShopSource | null => {
  if (typeof source !== 'string') return null;

  const normalized = source.toLowerCase().trim();
  if (normalized === 'bemanicn' || normalized === 'ziv' || normalized === 'nearcade') {
    return normalized;
  }
  return null;
};

const toInteger = (value: unknown): number | null => {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(parsed) ? parsed : null;
};

const toUnifiedId = (source: LegacyShopSource, id: number) => {
  if (source === 'bemanicn') return id + OFFSET_BEMANICN;
  if (source === 'ziv') return id + OFFSET_ZIV;
  return id;
};

const shopKey = (source: LegacyShopSource, id: number) => `${source}:${id}`;

const clampInt = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.floor(value)));

const normalizeNumericTime = (value: number): OpeningHourTime => {
  const normalized = ((value % 24) + 24) % 24 || 0;
  let hour = Math.floor(normalized);
  let minute = Math.round((normalized - hour) * 60);

  if (minute === 60) {
    minute = 0;
    hour = (hour + 1) % 24;
  }

  return { hour, minute };
};

const normalizeObjectTime = (value: unknown): OpeningHourTime | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { hour?: unknown; minute?: unknown };
  if (typeof candidate.hour !== 'number' || typeof candidate.minute !== 'number') {
    return null;
  }

  return {
    hour: clampInt(candidate.hour, 0, 23),
    minute: clampInt(candidate.minute, 0, 59)
  };
};

const normalizeOpeningHourPair = (
  entry: unknown
): { pair: OpeningHourPair; converted: boolean } | null => {
  if (!Array.isArray(entry) || entry.length < 2) {
    return null;
  }

  const [openRaw, closeRaw] = entry;
  const openObject = normalizeObjectTime(openRaw);
  const closeObject = normalizeObjectTime(closeRaw);

  if (openObject && closeObject) {
    return { pair: [openObject, closeObject], converted: false };
  }

  if (typeof openRaw === 'number' && typeof closeRaw === 'number') {
    return {
      pair: [normalizeNumericTime(openRaw), normalizeNumericTime(closeRaw)],
      converted: true
    };
  }

  return null;
};

const normalizeOpeningHours = (
  value: unknown
): {
  normalized: OpeningHourPair[];
  converted: boolean;
} | null => {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const normalized: OpeningHourPair[] = [];
  let converted = false;

  for (const entry of value) {
    const parsed = normalizeOpeningHourPair(entry);
    if (!parsed) return null;
    normalized.push(parsed.pair);
    converted = converted || parsed.converted;
  }

  return { normalized, converted };
};

const normalizeGamesForShop = (shopId: number, value: unknown): Document[] | null => {
  if (!Array.isArray(value)) return null;

  const parsed = value.map((entry, originalIndex) => {
    if (!entry || typeof entry !== 'object') return null;

    const candidate = entry as {
      id?: unknown;
      gameId?: unknown;
      titleId?: unknown;
      name?: unknown;
      version?: unknown;
      comment?: unknown;
      quantity?: unknown;
      cost?: unknown;
    } & Document;

    const titleId = toInteger(candidate.titleId);
    if (
      titleId === null ||
      typeof candidate.name !== 'string' ||
      typeof candidate.version !== 'string'
    ) {
      return null;
    }

    const { id: _legacyId, gameId: _legacyGameId, ...rest } = candidate;
    void _legacyId;
    void _legacyGameId;

    return {
      originalIndex,
      game: {
        ...rest,
        titleId,
        name: candidate.name,
        version: candidate.version,
        comment: typeof candidate.comment === 'string' ? candidate.comment : '',
        quantity:
          typeof candidate.quantity === 'number' && Number.isFinite(candidate.quantity)
            ? Math.max(0, Math.floor(candidate.quantity))
            : 1,
        cost: typeof candidate.cost === 'string' ? candidate.cost : ''
      }
    };
  });

  if (parsed.some((item) => item === null)) return null;

  const validGames = parsed as Array<{
    originalIndex: number;
    game: Document & { titleId: number; name: string; version: string };
  }>;
  const sorted = [...validGames].sort((left, right) => {
    return (
      left.game.titleId - right.game.titleId ||
      left.game.name.localeCompare(right.game.name) ||
      left.game.version.localeCompare(right.game.version) ||
      left.originalIndex - right.originalIndex
    );
  });

  const gameIdByOriginalIndex = new Map<number, number>();
  sorted.forEach((entry, index) => {
    gameIdByOriginalIndex.set(entry.originalIndex, shopId * 1000 + index);
  });

  return validGames.map((entry) => ({
    ...entry.game,
    gameId: gameIdByOriginalIndex.get(entry.originalIndex)!
  }));
};

const hasSameJsonValue = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

/**
 * The earlier migration inserted copies with offset ids, but accidentally kept
 * source on those copies. Detect those copies so they are not offset a second time.
 */
const isPreviouslyInsertedOffsetCopy = (doc: ShopDoc, legacyShopKeys: Set<string>) => {
  const id = toInteger(doc.id);
  const source = normalizeSource(doc.source);
  if (id === null || !source || source === 'nearcade') return false;

  if (source === 'bemanicn' && id >= OFFSET_BEMANICN) {
    return legacyShopKeys.has(shopKey(source, id - OFFSET_BEMANICN));
  }

  if (source === 'ziv' && id >= OFFSET_ZIV) {
    return legacyShopKeys.has(shopKey(source, id - OFFSET_ZIV));
  }

  return false;
};

const getUnifiedShopIdForShopDocument = (doc: ShopDoc, legacyShopKeys: Set<string>) => {
  const id = toInteger(doc.id);
  if (id === null) return null;

  const source = normalizeSource(doc.source);
  if (!source || source === 'nearcade' || isPreviouslyInsertedOffsetCopy(doc, legacyShopKeys)) {
    return id;
  }

  return toUnifiedId(source, id);
};

const getUnifiedShopIdFromReference = (value: unknown): number | null => {
  const id = toInteger(value);
  if (id !== null) return id;

  if (!value || typeof value !== 'object') return null;
  const ref = value as LegacyShopRef;
  const refId = toInteger(ref.id);
  const source = normalizeSource(ref.source);

  if (refId === null) return null;
  return source ? toUnifiedId(source, refId) : refId;
};

const normalizeReferenceArray = (value: unknown) => {
  if (!Array.isArray(value)) return null;

  const seen = new Set<number>();
  const normalized: number[] = [];

  for (const item of value) {
    const unifiedId = getUnifiedShopIdFromReference(item);
    if (unifiedId === null || seen.has(unifiedId)) continue;
    seen.add(unifiedId);
    normalized.push(unifiedId);
  }

  return normalized;
};

const hasSameArrayValue = (left: unknown, right: number[]) =>
  Array.isArray(left) &&
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

const documentTimestamp = (doc: ShopDoc) => {
  const dates = [doc.updatedAt, doc.createdAt]
    .map((value) => (value instanceof Date ? value.getTime() : 0))
    .filter((value) => value > 0);
  return dates.length > 0 ? Math.max(...dates) : 0;
};

const stringifyId = (id: ObjectId | unknown) =>
  typeof id === 'object' && id ? String(id) : `${id}`;

const updateOne = async (
  collection: Collection<Document>,
  filter: Document,
  update: Document,
  counter: { value: number }
) => {
  counter.value += 1;
  if (!DRY_RUN) {
    await collection.updateOne(filter, update);
  }
};

const deleteManyByIds = async (
  collection: Collection<Document>,
  ids: ObjectId[],
  counter: { value: number }
) => {
  if (ids.length === 0) return;
  counter.value += ids.length;
  if (!DRY_RUN) {
    await collection.deleteMany({ _id: { $in: ids } });
  }
};

const replaceOne = async (
  collection: Collection<Document>,
  id: ObjectId,
  replacement: Document,
  counter: { value: number }
) => {
  counter.value += 1;
  if (!DRY_RUN) {
    await collection.replaceOne({ _id: id }, replacement);
  }
};

const migrateShops = async (db: ReturnType<MongoClient['db']>) => {
  const shops = db.collection<Document>('shops');
  const allShops = (await shops.find({}).toArray()) as ShopDoc[];

  const legacyShopKeys = new Set<string>();
  for (const shop of allShops) {
    const id = toInteger(shop.id);
    const source = normalizeSource(shop.source);
    if (id !== null && source) {
      legacyShopKeys.add(shopKey(source, id));
    }
  }

  const groups = new Map<number, ShopDoc[]>();
  let invalid = 0;

  for (const shop of allShops) {
    const unifiedId = getUnifiedShopIdForShopDocument(shop, legacyShopKeys);
    if (unifiedId === null) {
      invalid += 1;
      continue;
    }

    const group = groups.get(unifiedId) || [];
    group.push(shop);
    groups.set(unifiedId, group);
  }

  const replaced = { value: 0 };
  const deleted = { value: 0 };

  for (const [unifiedId, group] of groups) {
    const keep = [...group].sort((a, b) => {
      const aAlreadyTarget = toInteger(a.id) === unifiedId ? 1 : 0;
      const bAlreadyTarget = toInteger(b.id) === unifiedId ? 1 : 0;
      const aNoSource = a.source === undefined ? 1 : 0;
      const bNoSource = b.source === undefined ? 1 : 0;
      return (
        bAlreadyTarget - aAlreadyTarget ||
        bNoSource - aNoSource ||
        documentTimestamp(b) - documentTimestamp(a)
      );
    })[0];

    const content = [...group].sort((a, b) => documentTimestamp(b) - documentTimestamp(a))[0];
    const { _id: _contentId, source: _source, syncedAt: _syncedAt, ...replacement } = content;
    void _contentId;
    void _source;
    void _syncedAt;

    const replacementDoc = {
      ...replacement,
      _id: keep._id,
      id: unifiedId
    };

    await replaceOne(shops, keep._id, replacementDoc, replaced);

    const duplicateIds = group
      .filter((shop) => stringifyId(shop._id) !== stringifyId(keep._id))
      .map((shop) => shop._id);
    await deleteManyByIds(shops, duplicateIds, deleted);
  }

  console.log(
    `shops: normalized ${replaced.value}, deleted ${deleted.value} duplicate/legacy docs, skipped ${invalid} invalid docs`
  );
};

const migrateShopSchemaFields = async (db: ReturnType<MongoClient['db']>) => {
  const shops = db.collection<Document>('shops');
  const allShops = (await shops.find({}).toArray()) as ShopDoc[];

  const bulkOps: AnyBulkWriteOperation<Document>[] = [];
  let migratedOpeningHours = 0;
  let migratedGames = 0;
  let invalidOpeningHours = 0;
  let invalidGames = 0;
  let invalidShopId = 0;

  for (const shop of allShops) {
    const updateSet: Document = {};

    const openingHours = normalizeOpeningHours(shop.openingHours);
    if (!openingHours) {
      invalidOpeningHours += 1;
    } else if (!hasSameJsonValue(shop.openingHours, openingHours.normalized)) {
      updateSet.openingHours = openingHours.normalized;
      migratedOpeningHours += 1;
    }

    const shopId = toInteger(shop.id);
    if (shopId === null) {
      invalidShopId += 1;
    } else {
      const normalizedGames = normalizeGamesForShop(shopId, shop.games);
      if (!normalizedGames) {
        invalidGames += 1;
      } else if (!hasSameJsonValue(shop.games, normalizedGames)) {
        updateSet.games = normalizedGames;
        migratedGames += 1;
      }
    }

    if (Object.keys(updateSet).length > 0) {
      bulkOps.push({
        updateOne: {
          filter: { _id: shop._id },
          update: { $set: updateSet }
        }
      });
    }
  }

  if (bulkOps.length > 0 && !DRY_RUN) {
    await shops.bulkWrite(bulkOps, { ordered: false });
  }

  console.log(
    `shops schema fields: openingHours updated ${migratedOpeningHours}, games updated ${migratedGames}, invalid openingHours ${invalidOpeningHours}, invalid games ${invalidGames}, invalid shop id ${invalidShopId}`
  );
};

const migrateArrayField = async (
  db: ReturnType<MongoClient['db']>,
  collectionName: string,
  field: string
) => {
  const collection = db.collection<Document>(collectionName);
  const updated = { value: 0 };
  const cursor = collection.find({ [field]: { $exists: true } });

  for await (const doc of cursor) {
    const normalized = normalizeReferenceArray(doc[field]);
    if (!normalized || hasSameArrayValue(doc[field], normalized)) continue;

    await updateOne(collection, { _id: doc._id }, { $set: { [field]: normalized } }, updated);
  }

  console.log(`${collectionName}.${field}: updated ${updated.value}`);
};

const migrateShopIdWithSourceField = async (
  db: ReturnType<MongoClient['db']>,
  collectionName: string
) => {
  const collection = db.collection<Document>(collectionName);
  const updated = { value: 0 };
  const cursor = collection.find({
    $or: [{ shopSource: { $exists: true } }, { shopId: { $exists: true } }]
  });

  for await (const doc of cursor) {
    const source = normalizeSource(doc.shopSource);
    const id = toInteger(doc.shopId);
    if (id === null) continue;

    const unifiedId = source ? toUnifiedId(source, id) : id;
    if (doc.shopId === unifiedId && doc.shopSource === undefined) continue;

    await updateOne(
      collection,
      { _id: doc._id },
      { $set: { shopId: unifiedId }, $unset: { shopSource: '' } },
      updated
    );
  }

  console.log(`${collectionName}: updated ${updated.value}`);
};

const migrateNestedShopReference = async (
  db: ReturnType<MongoClient['db']>,
  collectionName: string
) => {
  const collection = db.collection<Document>(collectionName);
  const updated = { value: 0 };
  const cursor = collection.find({
    $or: [{ shop: { $exists: true } }, { shopId: { $exists: true } }]
  });

  for await (const doc of cursor) {
    const unifiedId =
      doc.shop !== undefined
        ? getUnifiedShopIdFromReference(doc.shop)
        : getUnifiedShopIdFromReference(doc.shopId);
    if (unifiedId === null) continue;

    if (doc.shopId === unifiedId && doc.shop === undefined) continue;

    await updateOne(
      collection,
      { _id: doc._id },
      { $set: { shopId: unifiedId }, $unset: { shop: '' } },
      updated
    );
  }

  console.log(`${collectionName}: updated ${updated.value}`);
};

async function migrateShopSources() {
  console.log('Starting shop data migration...');
  console.log(`Using MongoDB URI: ${MONGODB_URI}`);
  if (DRY_RUN) {
    console.log('DRY RUN: no writes will be performed');
  }

  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI is not set');
  }

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db();

    await migrateShops(db);
    await migrateShopSchemaFields(db);

    await migrateArrayField(db, 'users', 'frequentingArcades');
    await migrateArrayField(db, 'users', 'starredArcades');
    await migrateArrayField(db, 'universities', 'frequentingArcades');
    await migrateArrayField(db, 'clubs', 'starredArcades');

    await migrateShopIdWithSourceField(db, 'queues');
    await migrateShopIdWithSourceField(db, 'machines');

    await migrateNestedShopReference(db, 'attendances');
    await migrateNestedShopReference(db, 'attendance_reports');

    console.log('\nMigration completed successfully!');
  } finally {
    await client.close();
  }
}

migrateShopSources()
  .then(() => {
    console.log('Migration script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration script failed:', error);
    process.exit(1);
  });
