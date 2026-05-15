/**
 * One-off script: unset `metadata` field where it is null in the `changelog` collection.
 * This aligns persisted data with the schema which marks metadata as optional (not nullable).
 *
 * Usage: pnpm tsx scripts/fix-nullish-changelog-metadata.ts
 */

import 'dotenv/config';
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set');
  process.exit(1);
}

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();

  const db = client.db();
  const changelog = db.collection('changelog');

  // Count affected documents
  const affected = await changelog.countDocuments({ metadata: null });
  console.log(`Found ${affected} changelog documents with null metadata`);

  if (affected > 0) {
    const result = await changelog.updateMany({ metadata: null }, { $unset: { metadata: '' } });
    console.log(`Updated ${result.modifiedCount} documents (unset null metadata)`);
  } else {
    console.log('Nothing to fix.');
  }

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
