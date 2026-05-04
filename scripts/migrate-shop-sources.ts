#!/usr/bin/env tsx
/**
 * Migration script: remove legacy ShopSource usage from MongoDB data.
 *
 * Final schema:
 * - shops use one numeric id and no source field
 * - references that were { source, id } become the unified numeric id
 * - BEMANICN ids are offset by +10000
 * - ZIv ids are offset by +20000
 *
 * The script is idempotent and can recover from the previous half-migration that
 * inserted offset copies while keeping source on both old and copied shop docs.
 */

import { MongoClient, type Collection, type Document, type ObjectId, type WithId } from 'mongodb';
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
};

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
  console.log('Starting ShopSource removal migration...');
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
