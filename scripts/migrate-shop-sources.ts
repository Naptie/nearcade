#!/usr/bin/env tsx
/**
 * Migration script: create nearcade-source copies of bemanicn and ziv shops.
 *
 * For each bemanicn shop:  inserts a new document with source='nearcade' and id = original_id + 10000
 * For each ziv shop:       inserts a new document with source='nearcade' and id = original_id + 20000
 *
 * Existing nearcade documents are left untouched. Re-running is safe because the
 * script checks for an existing document before inserting.
 */

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import type { Shop } from '../src/lib/types';

if (!('MONGODB_URI' in process.env)) {
  dotenv.config();
}

const MONGODB_URI = process.env.MONGODB_URI;

const OFFSET_BEMANICN = 10000;
const OFFSET_ZIV = 20000;

async function migrateShopSources() {
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI is not set');
  }

  console.log('Starting shop source migration...');

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db();
    const shopsCollection = db.collection<Shop>('shops');

    let bemanicnCount = 0;
    let zivCount = 0;
    let skipped = 0;

    // Migrate bemanicn → nearcade
    const bemanicnShops = await shopsCollection
      .find({ source: 'bemanicn' })
      .toArray();

    console.log(`Found ${bemanicnShops.length} bemanicn shops`);

    for (const shop of bemanicnShops) {
      const newId = shop.id + OFFSET_BEMANICN;
      const exists = await shopsCollection.findOne({ source: 'nearcade', id: newId });
      if (exists) {
        skipped++;
        continue;
      }

      const { _id, ...rest } = shop as Shop & { _id: unknown };
      void _id;

      await shopsCollection.insertOne({
        ...rest,
        source: 'nearcade' as Shop['source'],
        id: newId,
        updatedAt: new Date(),
        syncedAt: new Date()
      } as Parameters<typeof shopsCollection.insertOne>[0]);

      bemanicnCount++;
    }

    // Migrate ziv → nearcade
    const zivShops = await shopsCollection
      .find({ source: 'ziv' })
      .toArray();

    console.log(`Found ${zivShops.length} ziv shops`);

    for (const shop of zivShops) {
      const newId = shop.id + OFFSET_ZIV;
      const exists = await shopsCollection.findOne({ source: 'nearcade', id: newId });
      if (exists) {
        skipped++;
        continue;
      }

      const { _id, ...rest } = shop as Shop & { _id: unknown };
      void _id;

      await shopsCollection.insertOne({
        ...rest,
        source: 'nearcade' as Shop['source'],
        id: newId,
        updatedAt: new Date(),
        syncedAt: new Date()
      } as Parameters<typeof shopsCollection.insertOne>[0]);

      zivCount++;
    }

    console.log('\nMigration completed successfully!');
    console.log(`Migrated ${bemanicnCount} bemanicn shops (offset +${OFFSET_BEMANICN})`);
    console.log(`Migrated ${zivCount} ziv shops (offset +${OFFSET_ZIV})`);
    console.log(`Skipped ${skipped} already-migrated shops`);

    const totalNearcade = await shopsCollection.countDocuments({ source: 'nearcade' });
    console.log(`Total nearcade shops now: ${totalNearcade}`);
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
