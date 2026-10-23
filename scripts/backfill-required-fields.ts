/**
 * Backfill the two required fields that some stored documents never got.
 *
 * `shopDocumentSchema.comment` is `z.string()` — required, not optional — and
 * `imageAssetSchema.uploadedBy` is `userIdSchema.nullable()` — required, may be
 * null. A document missing either one fails output validation, and the whole
 * endpoint answers 500:
 *
 *   GET /api/shops/20192  ->  500 {"error":"INTERNAL_SERVER_ERROR","message":"Output validation failed"}
 *
 * The write paths already do the right thing (`shops/core-create.ts` writes
 * `comment: comment ?? ''`), so the affected rows are ones written before that
 * default existed — or imported. This brings them in line with the schema and
 * with what the app writes today.
 *
 * Idempotent: it only touches documents where the field is *absent*, so running
 * it twice is a no-op and a document with an explicit `null` or a real value is
 * left alone.
 *
 * Dry run by default; pass `--apply` to write.
 *
 *   pnpm exec tsx ./scripts/backfill-required-fields.ts
 *   pnpm exec tsx ./scripts/backfill-required-fields.ts --apply
 */
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';

config({ path: process.cwd() + '/.env' });

const APPLY = process.argv.includes('--apply');

const BACKFILLS = [
  { collection: 'shops', field: 'comment', value: '' },
  { collection: 'images', field: 'uploadedBy', value: null }
] as const;

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set');
  process.exit(1);
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
await client.connect();
try {
  const db = client.db(process.env.MONGODB_DB || process.env.DB_NAME || undefined);
  console.log(`database: ${db.databaseName}  mode: ${APPLY ? 'APPLY' : 'dry run'}\n`);

  let totalFixed = 0;
  for (const { collection, field, value } of BACKFILLS) {
    const col = db.collection(collection);
    const filter = { [field]: { $exists: false } };
    const affected = await col.countDocuments(filter);
    console.log(
      `${collection}.${field}: ${affected} document(s) missing the field -> set to ${JSON.stringify(value)}`
    );
    if (APPLY && affected > 0) {
      const res = await col.updateMany(filter, { $set: { [field]: value } });
      console.log(`  updated: ${res.modifiedCount}`);
      totalFixed += res.modifiedCount;
    } else {
      totalFixed += 0;
    }
    const remaining = await col.countDocuments(filter);
    console.log(`  remaining after: ${remaining}`);
  }

  console.log(
    `\n${APPLY ? `applied; ${totalFixed} document(s) updated.` : 'dry run — nothing written. Re-run with --apply.'}`
  );
} finally {
  await client.close();
}
