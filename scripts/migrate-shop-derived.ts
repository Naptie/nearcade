#!/usr/bin/env tsx
/**
 * nearcade — one-shot migration: canonical opening hours + derived shop fields.
 *
 * Rewrites every shop document so that:
 *   1. `openingHours` is in canonical extended form — the open side stays
 *      within the same day and an overnight close is expressed with hours
 *      ≥ 24 (legacy wraparound `22:00–02:00` becomes `22:00–26:00`).
 *   2. The server-maintained derived cache fields are backfilled:
 *      `openingMinutes`, `aggGames`, `gameTokens`, `stats`, `timezone`
 *      (`{ name }`, resolved from the coordinates). The legacy flat
 *      `timezoneName` field is removed.
 *
 * Both computations come from `src/lib/utils/shops/derived.ts`, the same single
 * source of truth the app uses on every write — this script only exists to
 * bring existing documents onto the new invariants. It is idempotent: already
 * migrated documents are skipped.
 *
 * The timezone move (`timezoneName` → `timezone: { name }`) is folded in here
 * rather than kept as a second script: `computeShopDerivedFields` already
 * resolves the zone from the coordinates, so a separate pass would only repeat
 * the same lookup and add a second source of truth for the same invariant.
 *
 * The name is ALWAYS re-resolved from the current coordinates, never carried
 * over from the legacy field — that is what the app itself does on every
 * write, so converging here means the next edit to a shop cannot silently
 * change its timezone. In practice almost every document re-resolves to the
 * value it already had; a small number may change, and those are exactly the
 * documents whose stored zone had drifted from their coordinates (e.g. a shop
 * whose pin was corrected after the old field was written). `Asia/Urumqi` is
 * coerced to `Asia/Shanghai` by the same national-convention rule the app uses.
 *
 * After running this against a database, trigger a Meilisearch full rebuild
 * (server boot or `POST /api/meilisearch/refresh`) so the index picks up the
 * new filter/sort attributes.
 *
 * Usage:
 *   pnpm tsx ./scripts/migrate-shop-derived.ts -- --dry-run
 *   MONGODB_URI=... pnpm tsx ./scripts/migrate-shop-derived.ts
 */
import { MongoClient } from 'mongodb';

if (!('MONGODB_URI' in process.env)) {
  const dotenv = await import('dotenv');
  dotenv.config();
}

import { computeShopDerivedFields, canonicalizeOpeningHours } from '../src/lib/utils/shops/derived';
import type { Shop } from '../src/lib/types';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('Missing MONGODB_URI (set it in .env or the environment).');
  process.exit(1);
}

const stableStringify = (value: unknown) => JSON.stringify(value ?? null);

interface MigrationStats {
  scanned: number;
  hoursCanonicalized: number;
  backfilled: number;
  alreadyMigrated: number;
  missingOpeningHours: number;
  missingLocation: number;
  failed: number;
}

const migrate = async () => {
  const client = new MongoClient(uri as string);
  await client.connect();
  const collection = client.db().collection<Shop>('shops');

  const stats: MigrationStats = {
    scanned: 0,
    hoursCanonicalized: 0,
    backfilled: 0,
    alreadyMigrated: 0,
    missingOpeningHours: 0,
    missingLocation: 0,
    failed: 0
  };

  const bulkOps: Array<{
    updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> };
  }> = [];
  const flush = async () => {
    if (dryRun || bulkOps.length === 0) {
      bulkOps.length = 0;
      return;
    }
    try {
      await collection.bulkWrite(bulkOps, { ordered: false });
    } catch (err) {
      stats.failed += bulkOps.length;
      console.error('Bulk write failed:', err);
    }
    bulkOps.length = 0;
  };

  const cursor = collection.find(
    {},
    {
      projection: {
        openingHours: 1,
        games: 1,
        location: 1,
        openingMinutes: 1,
        aggGames: 1,
        gameTokens: 1,
        stats: 1,
        timezone: 1,
        timezoneName: 1
      }
    }
  );
  for await (const shop of cursor) {
    stats.scanned += 1;

    // `computeShopDerivedFields` resolves the timezone from the coordinates, so
    // a document without a location cannot be migrated at all. `location` is
    // required by the schema, so this means a malformed document — but aborting
    // an entire production run over one of them is worse than skipping it
    // loudly, so report it and carry on.
    if (!shop.location) {
      console.warn(`[migrate-shop-derived] shop ${shop._id} has no location — skipped.`);
      stats.missingLocation += 1;
      continue;
    }

    const rawHours = (shop.openingHours ?? []) as Shop['openingHours'];
    if (rawHours.length === 0) stats.missingOpeningHours += 1;

    const canonicalHours = canonicalizeOpeningHours(rawHours);
    const hoursChanged = stableStringify(canonicalHours) !== stableStringify(rawHours);
    if (hoursChanged) stats.hoursCanonicalized += 1;

    const derived = computeShopDerivedFields({
      games: shop.games ?? [],
      openingHours: canonicalHours,
      location: shop.location
    });

    const set: Record<string, unknown> = {};
    if (hoursChanged) set.openingHours = canonicalHours;
    for (const [key, value] of Object.entries(derived)) {
      if (stableStringify((shop as Record<string, unknown>)[key]) !== stableStringify(value)) {
        set[key] = value;
      }
    }

    const unset: Record<string, ''> = {};
    if ((shop as Record<string, unknown>).timezoneName !== undefined) {
      unset.timezoneName = '';
    }

    if (Object.keys(set).length === 0 && Object.keys(unset).length === 0) {
      stats.alreadyMigrated += 1;
    } else {
      stats.backfilled += 1;
      const update: Record<string, unknown> = {};
      if (Object.keys(set).length > 0) update.$set = set;
      if (Object.keys(unset).length > 0) update.$unset = unset;
      bulkOps.push({ updateOne: { filter: { _id: shop._id }, update } });
    }

    if (bulkOps.length >= 500) await flush();
  }
  await flush();

  await client.close();

  console.log(
    `[migrate-shop-derived] scanned=${stats.scanned} ` +
      `hoursCanonicalized=${stats.hoursCanonicalized} backfilled=${stats.backfilled} ` +
      `alreadyMigrated=${stats.alreadyMigrated} missingOpeningHours=${stats.missingOpeningHours} ` +
      `missingLocation=${stats.missingLocation} ` +
      `failed=${stats.failed}${dryRun ? ' (dry run — nothing written)' : ''}`
  );
  if (stats.missingLocation > 0) {
    console.warn(
      `[migrate-shop-derived] ${stats.missingLocation} shop(s) were skipped for having no location — these need fixing by hand.`
    );
  }
  if (!dryRun && stats.backfilled > 0) {
    console.log(
      '[migrate-shop-derived] Next step: rebuild the Meilisearch index (server boot or POST /api/meilisearch/refresh).'
    );
  }
};

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
