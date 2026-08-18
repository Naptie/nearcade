#!/usr/bin/env tsx
/**
 * nearcade — seed data tool
 *
 * Produces and restores sanitized seed data for local development. Only
 * public, reproducible collections are included. Sanitization is minimal:
 * dropped fields are only `_id` (recreated by Mongo on insert), ownership
 * links that reference local accounts (`shops.isClaimed`), and image
 * references (`universities.avatarUrl`/`avatarImageId`). Timestamps and the
 * `counters.seq` value (the next allocated shop id) are preserved verbatim.
 *
 * Modes:
 *   dump    Extract + sanitize seed data from a source MongoDB into data/seed.
 *           The source is required — pass it via SEED_SOURCE env or --source.
 *   restore Restore data/seed into the target MongoDB (default: local compose mongo)
 *   clear   Drop the seed collections from the target MongoDB
 *
 * Usage:
 *   SEED_SOURCE=mongodb://host:27017/?dbName=nearcade pnpm seed:dump
 *   pnpm seed:dump -- --source mongodb://host:27017/?dbName=nearcade
 *   pnpm seed:restore
 *   pnpm seed:clear
 */
import { BSON, MongoClient, type Document } from 'mongodb';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Load .env so MONGODB_URI (and SEED_SOURCE) reflect the developer's actual
// local configuration instead of falling back to hardcoded defaults that may
// collide with an unrelated MongoDB instance on the same default port.
if (!('MONGODB_URI' in process.env)) {
  const dotenv = await import('dotenv');
  dotenv.config();
}

// Collections included in the seed, and their order of dependency.
const COLLECTIONS = ['regions', 'counters', 'universities', 'shops'] as const;

const DEFAULT_TARGET_URI = 'mongodb://mongo:27017/?dbName=nearcade';

const SEED_DIR = path.resolve(process.cwd(), 'data', 'seed');

const targetUri = () => process.env.MONGODB_URI ?? DEFAULT_TARGET_URI;

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

const unset = (doc: Document, fields: string[]) => {
  for (const field of fields) {
    delete doc[field];
  }
  return doc;
};

/**
 * Sanitization is intentionally minimal — only fields that are meaningless
 * or privacy/ownership-sensitive in a fresh local environment are removed.
 * Verified against real data (2026-08):
 *
 *  - shops: `_id` (recreated by Mongo on insert); `isClaimed` (only 2/7327
 *    docs have it, and it links to a user account that won't exist locally).
 *    `createdAt`/`updatedAt` are kept — they are part of the record.
 *  - universities: `_id`; `avatarUrl` + `avatarImageId` (image refs into OSS
 *    that won't be available). `createdAt` does not exist on universities
 *    (0/2919); `updatedAt` is kept. `backgroundColor` is user content, kept.
 *  - regions: `_id` only.
 *  - counters: `seq` is the actual next-slot id and MUST be preserved verbatim.
 */
const sanitizeShops = (doc: Document) => {
  unset(doc, ['_id', "comment", 'isClaimed']);
  return doc;
};

const sanitizeUniversities = (doc: Document) => {
  unset(doc, ['_id', 'avatarUrl', 'avatarImageId']);
  return doc;
};

const sanitizeRegions = (doc: Document) => {
  unset(doc, ['_id']);
  return doc;
};

const sanitizeCounters = (doc: Document) => {
  // `seq` is the next allocated shop id — keep it exactly as-is so newly
  // created shops continue from where the source data left off.
  return doc;
};

const sanitize = (collection: string, doc: Document): Document => {
  switch (collection) {
    case 'shops':
      return sanitizeShops(doc);
    case 'universities':
      return sanitizeUniversities(doc);
    case 'regions':
      return sanitizeRegions(doc);
    case 'counters':
      return sanitizeCounters(doc);
    default:
      return doc;
  }
};

// ---------------------------------------------------------------------------
// dump
// ---------------------------------------------------------------------------

async function dump(source: string) {
  const uri = source;
  console.log(`[seed] Dumping from ${uri}`);
  const client = new MongoClient(uri);
  await client.connect();
  await mkdir(SEED_DIR, { recursive: true });

  const db = client.db();
  for (const collection of COLLECTIONS) {
    const docs = await db.collection(collection).find().toArray();
    const sanitized = docs.map((doc) => sanitize(collection, doc));
    const file = path.join(SEED_DIR, `${collection}.json`);
    await writeFile(file, BSON.EJSON.stringify(sanitized), 'utf8');
    console.log(
      `[seed]   ${collection}: ${sanitized.length} documents -> ${path.relative(process.cwd(), file)}`
    );
  }

  await client.close();
  console.log('[seed] Dump complete.');
}

// ---------------------------------------------------------------------------
// restore
// ---------------------------------------------------------------------------

async function restore() {
  const uri = targetUri();
  console.log(`[seed] Restoring into ${uri}`);
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();

  const files = (await readdir(SEED_DIR)).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    console.error('[seed] No seed files found in data/seed/. Run "pnpm seed:dump" first.');
    process.exit(1);
  }

  for (const file of files) {
    const collection = path.basename(file, '.json');
    const raw = await readFile(path.join(SEED_DIR, file), 'utf8');
    const docs = BSON.EJSON.parse(raw) as Document[];

    if (docs.length === 0) {
      console.log(`[seed]   ${collection}: empty, skipping`);
      continue;
    }

    await db.collection(collection).deleteMany({});
    await db.collection(collection).insertMany(docs, { ordered: false });
    console.log(`[seed]   ${collection}: restored ${docs.length} documents`);
  }

  await client.close();
  console.log('[seed] Restore complete.');
}

// ---------------------------------------------------------------------------
// clear
// ---------------------------------------------------------------------------

async function clear() {
  const uri = targetUri();
  console.log(`[seed] Clearing seed collections in ${uri}`);
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();

  for (const collection of COLLECTIONS) {
    await db.collection(collection).deleteMany({});
    console.log(`[seed]   ${collection}: cleared`);
  }

  await client.close();
  console.log('[seed] Clear complete.');
}

// ---------------------------------------------------------------------------

const mode = process.argv[2];

// Parse `--source <uri>` / `--source=<uri>` (used by dump).
const sourceArgIndex = process.argv.indexOf('--source');
let source = process.env.SEED_SOURCE;
if (sourceArgIndex !== -1) {
  const inline = process.argv[sourceArgIndex + 1];
  if (inline && !inline.startsWith('--')) {
    source = inline;
  } else {
    console.error('ERROR: --source requires a value, e.g. --source=mongodb://host/db');
    process.exit(1);
  }
}
for (const arg of process.argv.slice(3)) {
  if (arg.startsWith('--source=')) {
    source = arg.slice('--source='.length);
  }
}

switch (mode) {
  case 'dump':
    if (!source) {
      console.error(
        'ERROR: dump requires a source database. Set SEED_SOURCE or pass --source=mongodb://host/db'
      );
      process.exit(1);
    }
    await dump(source);
    break;
  case 'restore':
    await restore();
    break;
  case 'clear':
    await clear();
    break;
  default:
    console.error('Usage: seed.ts <dump|restore|clear>');
    process.exit(1);
}
