#!/usr/bin/env tsx
/**
 * Avatar migration script.
 *
 * Downloads external avatar images for users, universities, and clubs,
 * then uploads them to OSS and updates the corresponding documents.
 *
 * Usage:
 *   tsx scripts/migrate-avatars-to-oss.ts [--dry-run]
 *
 * Options:
 *   --dry-run   Log what would be changed without making any writes.
 */

import { MongoClient } from 'mongodb';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { nanoid } from 'nanoid';
import dotenv from 'dotenv';

if (!('MONGODB_URI' in process.env)) {
  dotenv.config();
}

const MONGODB_URI = process.env.MONGODB_URI;
const OSS_S3_BASE64 = process.env.OSS_S3_BASE64;
const IMAGE_STORAGE_PREFIX = 'nearcade';

const DRY_RUN = process.argv.includes('--dry-run');

if (!MONGODB_URI) {
  console.error('MONGODB_URI is not set');
  process.exit(1);
}

if (!OSS_S3_BASE64) {
  console.error(
    'OSS_S3_BASE64 is not set (only S3-compatible storage is supported by this script)'
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// S3 setup
// ---------------------------------------------------------------------------

interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketEndpoint: boolean;
  forcePathStyle: boolean;
}

const s3Config: S3Config = JSON.parse(Buffer.from(OSS_S3_BASE64, 'base64').toString('utf8'));

const s3 = new S3Client({
  region: s3Config.region,
  endpoint: s3Config.endpoint,
  bucketEndpoint: s3Config.bucketEndpoint,
  forcePathStyle: s3Config.forcePathStyle,
  credentials: {
    accessKeyId: s3Config.accessKeyId,
    secretAccessKey: s3Config.secretAccessKey
  }
});

const getS3BaseUrl = () =>
  s3Config.bucketEndpoint ? s3Config.bucket : `${s3Config.endpoint}/${s3Config.bucket}`;

const uploadToS3 = async (key: string, buffer: Buffer, contentType: string): Promise<string> => {
  const upload = new Upload({
    client: s3,
    params: {
      Bucket: s3Config.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType
    }
  });

  await upload.done();
  return `${getS3BaseUrl()}/${encodeURIComponent(key)}`;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isOssUrl = (url: string): boolean => {
  const baseUrl = getS3BaseUrl();
  return url.startsWith(baseUrl);
};

const getExtensionFromUrl = (url: string, contentType: string): string => {
  const urlPath = url.split('?')[0];
  const fromPath = urlPath.split('.').pop()?.toLowerCase();
  if (fromPath && /^[a-z]{2,5}$/.test(fromPath)) return fromPath;
  const fromMime = contentType.split('/')[1]?.split(';')[0]?.toLowerCase();
  if (fromMime) return fromMime === 'jpeg' ? 'jpg' : fromMime;
  return 'jpg';
};

const downloadImage = async (
  url: string
): Promise<{ buffer: Buffer; contentType: string } | null> => {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'nearcade-avatar-migrator/1.0' }
    });

    if (!response.ok) {
      console.warn(`  Failed to download ${url}: HTTP ${response.status}`);
      return null;
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      console.warn(`  Skipping ${url}: not an image (${contentType})`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), contentType };
  } catch (err) {
    console.warn(`  Error downloading ${url}:`, err);
    return null;
  }
};

// ---------------------------------------------------------------------------
// Migration functions
// ---------------------------------------------------------------------------

const migrateUserAvatars = async (db: ReturnType<MongoClient['db']>) => {
  console.log('\n--- Migrating user avatars ---');
  const usersCollection = db.collection('users');

  const users = await usersCollection
    .find({ image: { $ne: null, $exists: true }, avatarStorageKey: { $exists: false } })
    .project({ id: 1, image: 1 })
    .toArray();

  console.log(`Found ${users.length} users with external avatar URLs`);

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const user of users) {
    const imageUrl = user.image as string;
    if (!imageUrl || isOssUrl(imageUrl)) {
      skipped++;
      continue;
    }

    console.log(`  User ${user.id}: ${imageUrl}`);

    if (DRY_RUN) {
      console.log(`    [DRY RUN] Would download and upload to OSS`);
      migrated++;
      continue;
    }

    const downloaded = await downloadImage(imageUrl);
    if (!downloaded) {
      failed++;
      continue;
    }

    const avatarId = nanoid();
    const extension = getExtensionFromUrl(imageUrl, downloaded.contentType);
    const storageKey = `${IMAGE_STORAGE_PREFIX}/avatars/users/${user.id}/${avatarId}.${extension}`;

    try {
      const newUrl = await uploadToS3(storageKey, downloaded.buffer, downloaded.contentType);
      await usersCollection.updateOne(
        { id: user.id },
        {
          $set: {
            image: newUrl,
            avatarStorageProvider: 's3',
            avatarStorageKey: storageKey,
            avatarStorageObjectId: null,
            updatedAt: new Date()
          }
        }
      );
      console.log(`    Uploaded to ${storageKey}`);
      migrated++;
    } catch (err) {
      console.error(`    Upload failed:`, err);
      failed++;
    }
  }

  console.log(`  Migrated: ${migrated}, Skipped: ${skipped}, Failed: ${failed}`);
};

const migrateUniversityAvatars = async (db: ReturnType<MongoClient['db']>) => {
  console.log('\n--- Migrating university avatars ---');
  const universitiesCollection = db.collection('universities');

  const universities = await universitiesCollection
    .find({ avatarUrl: { $ne: null, $exists: true }, avatarStorageKey: { $exists: false } })
    .project({ id: 1, avatarUrl: 1 })
    .toArray();

  console.log(`Found ${universities.length} universities with external avatar URLs`);

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const university of universities) {
    const avatarUrl = university.avatarUrl as string;
    if (!avatarUrl || isOssUrl(avatarUrl)) {
      skipped++;
      continue;
    }

    console.log(`  University ${university.id}: ${avatarUrl}`);

    if (DRY_RUN) {
      console.log(`    [DRY RUN] Would download and upload to OSS`);
      migrated++;
      continue;
    }

    const downloaded = await downloadImage(avatarUrl);
    if (!downloaded) {
      failed++;
      continue;
    }

    const avatarId = nanoid();
    const extension = getExtensionFromUrl(avatarUrl, downloaded.contentType);
    const storageKey = `${IMAGE_STORAGE_PREFIX}/avatars/universities/${university.id}/${avatarId}.${extension}`;

    try {
      const newUrl = await uploadToS3(storageKey, downloaded.buffer, downloaded.contentType);
      await universitiesCollection.updateOne(
        { id: university.id },
        {
          $set: {
            avatarUrl: newUrl,
            avatarStorageProvider: 's3',
            avatarStorageKey: storageKey,
            avatarStorageObjectId: null,
            updatedAt: new Date()
          }
        }
      );
      console.log(`    Uploaded to ${storageKey}`);
      migrated++;
    } catch (err) {
      console.error(`    Upload failed:`, err);
      failed++;
    }
  }

  console.log(`  Migrated: ${migrated}, Skipped: ${skipped}, Failed: ${failed}`);
};

const migrateClubAvatars = async (db: ReturnType<MongoClient['db']>) => {
  console.log('\n--- Migrating club avatars ---');
  const clubsCollection = db.collection('clubs');

  const clubs = await clubsCollection
    .find({ avatarUrl: { $ne: null, $exists: true }, avatarStorageKey: { $exists: false } })
    .project({ id: 1, avatarUrl: 1 })
    .toArray();

  console.log(`Found ${clubs.length} clubs with external avatar URLs`);

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const club of clubs) {
    const avatarUrl = club.avatarUrl as string;
    if (!avatarUrl || isOssUrl(avatarUrl)) {
      skipped++;
      continue;
    }

    console.log(`  Club ${club.id}: ${avatarUrl}`);

    if (DRY_RUN) {
      console.log(`    [DRY RUN] Would download and upload to OSS`);
      migrated++;
      continue;
    }

    const downloaded = await downloadImage(avatarUrl);
    if (!downloaded) {
      failed++;
      continue;
    }

    const avatarId = nanoid();
    const extension = getExtensionFromUrl(avatarUrl, downloaded.contentType);
    const storageKey = `${IMAGE_STORAGE_PREFIX}/avatars/clubs/${club.id}/${avatarId}.${extension}`;

    try {
      const newUrl = await uploadToS3(storageKey, downloaded.buffer, downloaded.contentType);
      await clubsCollection.updateOne(
        { id: club.id },
        {
          $set: {
            avatarUrl: newUrl,
            avatarStorageProvider: 's3',
            avatarStorageKey: storageKey,
            avatarStorageObjectId: null,
            updatedAt: new Date()
          }
        }
      );
      console.log(`    Uploaded to ${storageKey}`);
      migrated++;
    } catch (err) {
      console.error(`    Upload failed:`, err);
      failed++;
    }
  }

  console.log(`  Migrated: ${migrated}, Skipped: ${skipped}, Failed: ${failed}`);
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async () => {
  if (DRY_RUN) {
    console.log('Running in DRY RUN mode — no changes will be written');
  }

  const client = new MongoClient(MONGODB_URI!);
  await client.connect();
  console.log('Connected to MongoDB');

  try {
    const db = client.db();
    await migrateUserAvatars(db);
    await migrateUniversityAvatars(db);
    await migrateClubAvatars(db);
  } finally {
    await client.close();
    console.log('\nDone.');
  }
};

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
