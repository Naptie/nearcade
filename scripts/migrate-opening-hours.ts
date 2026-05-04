#!/usr/bin/env tsx
/**
 * Opening hours validation script.
 *
 * The openingHours schema supports fractional hours (e.g. 10.5 = 10:30, 22.75 = 22:45).
 * Historically, all stored values were integers. This script validates that all existing
 * values are valid numbers and reports any unusual (non-integer) entries.
 *
 * No data modifications are performed.
 */

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import type { Shop } from '../src/lib/types';

if (!('MONGODB_URI' in process.env)) {
  dotenv.config();
}

const MONGODB_URI = process.env.MONGODB_URI;

async function validateOpeningHours() {
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI is not set');
  }

  console.log('Validating opening hours data...\n');

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db();
    const shopsCollection = db.collection<Shop>('shops');

    const shops = await shopsCollection.find({}).toArray();
    console.log(`Total shops: ${shops.length}`);

    let valid = 0;
    let fractional = 0;
    let invalid = 0;
    const issues: { id: number; source: string; value: unknown }[] = [];

    for (const shop of shops) {
      if (!Array.isArray(shop.openingHours) || shop.openingHours.length === 0) {
        invalid++;
        issues.push({ id: shop.id, source: shop.source, value: shop.openingHours });
        continue;
      }

      let shopOk = true;

      for (const [openTime, closeTime] of shop.openingHours) {
        if (typeof openTime !== 'number' || typeof closeTime !== 'number') {
          invalid++;
          issues.push({ id: shop.id, source: shop.source, value: [openTime, closeTime] });
          shopOk = false;
          break;
        }

        if (openTime % 1 !== 0 || closeTime % 1 !== 0) {
          fractional++;
          issues.push({ id: shop.id, source: shop.source, value: [openTime, closeTime] });
          shopOk = false;
          break;
        }
      }

      if (shopOk) valid++;
    }

    console.log(`\n=== Opening Hours Validation Report ===`);
    console.log(`  Integer-only (valid legacy format): ${valid}`);
    console.log(`  Fractional hours (new format):      ${fractional}`);
    console.log(`  Invalid/missing:                    ${invalid}`);

    if (issues.length > 0) {
      console.log('\nShops with non-integer or invalid opening hours:');
      for (const issue of issues.slice(0, 20)) {
        console.log(`  [${issue.source}] id=${issue.id}  value=${JSON.stringify(issue.value)}`);
      }
      if (issues.length > 20) {
        console.log(`  ... and ${issues.length - 20} more`);
      }
    } else {
      console.log(
        '\nAll shops have integer opening hours — schema migration is backwards compatible.'
      );
    }
  } finally {
    await client.close();
  }
}

validateOpeningHours()
  .then(() => {
    console.log('\nValidation script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Validation script failed:', error);
    process.exit(1);
  });
