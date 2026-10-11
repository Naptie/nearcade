/// <reference types="node" />
/**
 * One-off migration: rollback changelog entries used to embed the full
 * pre-rollback shop document in `metadata.oldShop` (plus a write-only
 * `metadata.newShop`) — both readable by anyone through the public changelog
 * APIs. This moves the pre-rollback copy into the private
 * `shop_changelog_snapshots` collection (keyed by the entry id, read only by
 * the rollback reversal path — see applyShopRollback) and strips both fields
 * from the ledger.
 *
 * Reversibility is preserved on purpose: erasing the *content* of a specific
 * rollback (retention: 'purge' at rollback time, or a targeted removal for an
 * incident) is a separate, deliberate action.
 *
 * Usage:
 *   pnpm exec tsx scripts/migrate-changelog-snapshots.ts [--dry-run]
 *
 * Safe to re-run: snapshots are upserted by entryId and already-migrated
 * entries (no inline oldShop/newShop left) are skipped.
 */

import 'dotenv/config';
import { MongoClient } from 'mongodb';

const dryRun = process.argv.includes('--dry-run');

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set');
  process.exit(1);
}

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();
  const db = client.db();

  const changelog = db.collection('shop_changelog');
  const snapshots = db.collection('shop_changelog_snapshots');

  // Only entries still carrying an inline snapshot need migration; entries
  // with just newShop (should not exist — oldShop was always written) are
  // picked up by the cleanup pass below.
  const cursor = changelog.find(
    { action: 'rollback', 'metadata.oldShop': { $exists: true, $type: 'object' } },
    { projection: { id: 1, shopId: 1, createdAt: 1, 'metadata.oldShop': 1 } }
  );

  let migrated = 0;
  let skipped = 0;

  for await (const entry of cursor) {
    const snapshot = (entry.metadata as { oldShop?: unknown }).oldShop;
    if (!snapshot || typeof snapshot !== 'object') {
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`[dry-run] would migrate rollback entry ${entry.id} (shop ${entry.shopId})`);
      migrated++;
      continue;
    }

    await snapshots.updateOne(
      { entryId: entry.id },
      {
        $set: {
          entryId: entry.id,
          shopId: entry.shopId,
          snapshot,
          createdAt: entry.createdAt ?? new Date()
        }
      },
      { upsert: true }
    );
    await changelog.updateOne(
      { id: entry.id },
      { $unset: { 'metadata.oldShop': '', 'metadata.newShop': '' } }
    );
    migrated++;
  }

  // Sweep entries whose oldShop was missing/unusable but still carry newShop.
  let cleaned = 0;
  if (!dryRun) {
    const result = await changelog.updateMany(
      { action: 'rollback', 'metadata.newShop': { $exists: true } },
      { $unset: { 'metadata.newShop': '' } }
    );
    cleaned = result.modifiedCount;
  }

  console.log(
    `${dryRun ? '[dry-run] ' : ''}migrated ${migrated} rollback entr${migrated === 1 ? 'y' : 'ies'}` +
      `${skipped ? `, skipped ${skipped} (unusable snapshot)` : ''}` +
      `${cleaned ? `, cleaned newShop-only entries: ${cleaned}` : ''}`
  );

  await client.close();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
