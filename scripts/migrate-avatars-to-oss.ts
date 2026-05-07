#!/usr/bin/env tsx
/**
 * Avatar migration script.
 *
 * Downloads external avatar images for users, universities, and clubs,
 * uploads them to OSS, inserts ImageAsset records into the images collection,
 * and updates each entity with avatarImageId (+ image/avatarUrl for display).
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
import AV from 'leancloud-storage';

if (!('MONGODB_URI' in process.env)) {
  dotenv.config();
}

const MONGODB_URI = process.env.MONGODB_URI;
const OSS_S3_BASE64 = process.env.OSS_S3_BASE64;
const OSS_LEANCLOUD_APP_ID = process.env.OSS_LEANCLOUD_APP_ID;
const OSS_LEANCLOUD_APP_KEY = process.env.OSS_LEANCLOUD_APP_KEY;
const OSS_LEANCLOUD_SERVER_URL = process.env.OSS_LEANCLOUD_SERVER_URL;
const OSS_LEANCLOUD_MASTER_KEY = process.env.OSS_LEANCLOUD_MASTER_KEY;
const IMAGE_STORAGE_PREFIX = 'nearcade';
const IMAGES_COLLECTION = 'images';

const DRY_RUN = process.argv.includes('--dry-run');

if (!MONGODB_URI) {
  console.error('MONGODB_URI is not set');
  process.exit(1);
}

if (!OSS_S3_BASE64 && (!OSS_LEANCLOUD_APP_ID || !OSS_LEANCLOUD_APP_KEY)) {
  console.error(
    'No OSS provider is configured (set OSS_S3_BASE64 or OSS_LEANCLOUD_APP_ID + OSS_LEANCLOUD_APP_KEY)'
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// OSS setup
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

interface UploadedFileDescriptor {
  url: string;
  storageProvider: 's3' | 'leancloud';
  storageKey: string;
  storageObjectId: string | null;
}

const s3Config: S3Config | undefined = OSS_S3_BASE64
  ? JSON.parse(Buffer.from(OSS_S3_BASE64, 'base64').toString('utf8'))
  : undefined;

const s3 = s3Config
  ? new S3Client({
      region: s3Config.region,
      endpoint: s3Config.endpoint,
      bucketEndpoint: s3Config.bucketEndpoint,
      forcePathStyle: s3Config.forcePathStyle,
      credentials: {
        accessKeyId: s3Config.accessKeyId,
        secretAccessKey: s3Config.secretAccessKey
      }
    })
  : undefined;

if (OSS_LEANCLOUD_APP_ID && OSS_LEANCLOUD_APP_KEY) {
  const options: { appId: string; appKey: string; serverURL?: string; masterKey?: string } = {
    appId: OSS_LEANCLOUD_APP_ID,
    appKey: OSS_LEANCLOUD_APP_KEY
  };
  if (OSS_LEANCLOUD_SERVER_URL) {
    options.serverURL = OSS_LEANCLOUD_SERVER_URL;
  }
  if (OSS_LEANCLOUD_MASTER_KEY) {
    options.masterKey = OSS_LEANCLOUD_MASTER_KEY;
  }
  AV.init(options);
}

const getS3BaseUrl = () => {
  if (!s3Config) return undefined;
  return s3Config.bucketEndpoint ? s3Config.bucket : `${s3Config.endpoint}/${s3Config.bucket}`;
};

const uploadToS3 = async (
  key: string,
  buffer: Buffer,
  contentType: string
): Promise<UploadedFileDescriptor | undefined> => {
  if (!s3 || !s3Config) return undefined;

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
  return {
    url: `${getS3BaseUrl()}/${encodeURIComponent(key)}`,
    storageProvider: 's3',
    storageKey: key,
    storageObjectId: null
  };
};

const uploadToLeanCloud = async (
  key: string,
  buffer: Buffer
): Promise<UploadedFileDescriptor | undefined> => {
  if (!OSS_LEANCLOUD_APP_ID || !OSS_LEANCLOUD_APP_KEY) return undefined;

  const ossFile = await new AV.File(key, buffer).save({
    keepFileName: true
  });

  const url = ossFile.url();
  if (!url) {
    throw new Error('LeanCloud upload did not return a file URL');
  }
  if (!ossFile.id) {
    throw new Error('LeanCloud upload did not return a file object id');
  }

  return {
    url,
    storageProvider: 'leancloud',
    storageKey: key,
    storageObjectId: ossFile.id
  };
};

const uploadToOSS = async (
  key: string,
  buffer: Buffer,
  contentType: string
): Promise<UploadedFileDescriptor> => {
  const uploadedFile =
    (await uploadToS3(key, buffer, contentType)) || (await uploadToLeanCloud(key, buffer));

  if (!uploadedFile) {
    throw new Error('No OSS provider available');
  }

  return uploadedFile;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isOssUrl = (url: string): boolean => {
  const baseUrl = getS3BaseUrl();
  return !!baseUrl && url.startsWith(baseUrl);
};

const getImageAssetStorageFields = (uploadedFile: UploadedFileDescriptor) => ({
  url: uploadedFile.url,
  storageProvider: uploadedFile.storageProvider,
  storageKey: uploadedFile.storageKey,
  storageObjectId: uploadedFile.storageObjectId
});

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
  const imagesCollection = db.collection(IMAGES_COLLECTION);

  const users = await usersCollection
    .find({ image: { $ne: null, $exists: true }, avatarImageId: { $exists: false } })
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
      console.log(`    [DRY RUN] Would download, upload to OSS, and create ImageAsset record`);
      migrated++;
      continue;
    }

    const downloaded = await downloadImage(imageUrl);
    if (!downloaded) {
      failed++;
      continue;
    }

    const imageId = nanoid();
    const extension = getExtensionFromUrl(imageUrl, downloaded.contentType);
    const storageKey = `${IMAGE_STORAGE_PREFIX}/images/avatars/users/${user.id}/${imageId}.${extension}`;

    try {
      const uploadedFile = await uploadToOSS(storageKey, downloaded.buffer, downloaded.contentType);

      await imagesCollection.insertOne({
        id: imageId,
        userId: user.id,
        ...getImageAssetStorageFields(uploadedFile),
        uploadedBy: user.id,
        uploadedAt: new Date()
      });

      await usersCollection.updateOne(
        { id: user.id },
        {
          $set: {
            image: uploadedFile.url,
            avatarImageId: imageId,
            updatedAt: new Date()
          }
        }
      );
      console.log(`    Uploaded to ${storageKey} (imageId: ${imageId})`);
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
  const imagesCollection = db.collection(IMAGES_COLLECTION);

  const universities = await universitiesCollection
    .find({ avatarUrl: { $ne: null, $exists: true }, avatarImageId: { $exists: false } })
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
      console.log(`    [DRY RUN] Would download, upload to OSS, and create ImageAsset record`);
      migrated++;
      continue;
    }

    const downloaded = await downloadImage(avatarUrl);
    if (!downloaded) {
      failed++;
      continue;
    }

    const imageId = nanoid();
    const extension = getExtensionFromUrl(avatarUrl, downloaded.contentType);
    const storageKey = `${IMAGE_STORAGE_PREFIX}/images/avatars/universities/${university.id}/${imageId}.${extension}`;

    try {
      const uploadedFile = await uploadToOSS(storageKey, downloaded.buffer, downloaded.contentType);

      await imagesCollection.insertOne({
        id: imageId,
        universityId: university.id,
        ...getImageAssetStorageFields(uploadedFile),
        uploadedBy: null,
        uploadedAt: new Date()
      });

      await universitiesCollection.updateOne(
        { id: university.id },
        {
          $set: {
            avatarUrl: uploadedFile.url,
            avatarImageId: imageId,
            updatedAt: new Date()
          }
        }
      );
      console.log(`    Uploaded to ${storageKey} (imageId: ${imageId})`);
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
  const imagesCollection = db.collection(IMAGES_COLLECTION);

  const clubs = await clubsCollection
    .find({ avatarUrl: { $ne: null, $exists: true }, avatarImageId: { $exists: false } })
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
      console.log(`    [DRY RUN] Would download, upload to OSS, and create ImageAsset record`);
      migrated++;
      continue;
    }

    const downloaded = await downloadImage(avatarUrl);
    if (!downloaded) {
      failed++;
      continue;
    }

    const imageId = nanoid();
    const extension = getExtensionFromUrl(avatarUrl, downloaded.contentType);
    const storageKey = `${IMAGE_STORAGE_PREFIX}/images/avatars/clubs/${club.id}/${imageId}.${extension}`;

    try {
      const uploadedFile = await uploadToOSS(storageKey, downloaded.buffer, downloaded.contentType);

      await imagesCollection.insertOne({
        id: imageId,
        clubId: club.id,
        ...getImageAssetStorageFields(uploadedFile),
        uploadedBy: null,
        uploadedAt: new Date()
      });

      await clubsCollection.updateOne(
        { id: club.id },
        {
          $set: {
            avatarUrl: uploadedFile.url,
            avatarImageId: imageId,
            updatedAt: new Date()
          }
        }
      );
      console.log(`    Uploaded to ${storageKey} (imageId: ${imageId})`);
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
