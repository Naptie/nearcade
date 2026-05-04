#!/usr/bin/env tsx
/**
 * Opening hours migration script.
 *
 * Migrates `openingHours` from legacy numeric pairs:
 *   [openTime: number, closeTime: number][]
 * to object-based pairs:
 *   [{ hour: number, minute: number }, { hour: number, minute: number }][]
 *
 * The migration is idempotent. Already-migrated records are left untouched.
 */

import { MongoClient, type AnyBulkWriteOperation } from 'mongodb';
import dotenv from 'dotenv';
import type { Shop } from '../src/lib/types';

if (!('MONGODB_URI' in process.env)) {
  dotenv.config();
}

const MONGODB_URI = process.env.MONGODB_URI;

type OpeningHourTime = {
  hour: number;
  minute: number;
};

type OpeningHourPair = [OpeningHourTime, OpeningHourTime];

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function normalizeNumericTime(value: number): OpeningHourTime {
  const normalized = (((value % 24) + 24) % 24) || 0;
  let hour = Math.floor(normalized);
  let minute = Math.round((normalized - hour) * 60);

  if (minute === 60) {
    minute = 0;
    hour = (hour + 1) % 24;
  }

  return { hour, minute };
}

function normalizeObjectTime(value: unknown): OpeningHourTime | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { hour?: unknown; minute?: unknown };
  if (typeof candidate.hour !== 'number' || typeof candidate.minute !== 'number') {
    return null;
  }

  return {
    hour: clampInt(candidate.hour, 0, 23),
    minute: clampInt(candidate.minute, 0, 59)
  };
}

function normalizePair(entry: unknown): { pair: OpeningHourPair; converted: boolean } | null {
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
}

function normalizeOpeningHours(value: unknown): {
  normalized: OpeningHourPair[];
  converted: boolean;
} | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const normalized: OpeningHourPair[] = [];
  let converted = false;

  for (const entry of value) {
    const parsed = normalizePair(entry);
    if (!parsed) return null;
    normalized.push(parsed.pair);
    converted = converted || parsed.converted;
  }

  return { normalized, converted };
}

async function migrateOpeningHours() {
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI is not set');
  }

  console.log('Migrating opening hours data...\n');

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db();
    const shopsCollection = db.collection<Shop>('shops');

    const shops = await shopsCollection.find({}).toArray();
    console.log(`Total shops: ${shops.length}`);

    let unchanged = 0;
    let migrated = 0;
    let invalid = 0;
    const bulkOps: AnyBulkWriteOperation<Shop>[] = [];
    const issues: { id: number; value: unknown }[] = [];

    for (const shop of shops) {
      const normalized = normalizeOpeningHours(shop.openingHours);

      if (!normalized) {
        invalid++;
        issues.push({ id: shop.id, value: shop.openingHours });
        continue;
      }

      if (normalized.converted) {
        migrated++;
        bulkOps.push({
          updateOne: {
            filter: { _id: shop._id },
            update: {
              $set: {
                openingHours: normalized.normalized
              }
            }
          }
        });
      } else {
        unchanged++;
      }
    }

    if (bulkOps.length > 0) {
      const result = await shopsCollection.bulkWrite(bulkOps, { ordered: false });
      console.log(`Updated documents: ${result.modifiedCount}`);
    }

    console.log(`\n=== Opening Hours Migration Report ===`);
    console.log(`  Migrated from numeric format: ${migrated}`);
    console.log(`  Already object format:        ${unchanged}`);
    console.log(`  Invalid/missing:              ${invalid}`);

    if (issues.length > 0) {
      console.log('\nShops with invalid opening hours:');
      for (const issue of issues.slice(0, 20)) {
        console.log(`  [${issue.id}]  value=${JSON.stringify(issue.value)}`);
      }
      if (issues.length > 20) {
        console.log(`  ... and ${issues.length - 20} more`);
      }
    } else {
      console.log('\nAll shops have valid opening hours after migration.');
    }
  } finally {
    await client.close();
  }
}

migrateOpeningHours()
  .then(() => {
    console.log('\nMigration script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration script failed:', error);
    process.exit(1);
  });
