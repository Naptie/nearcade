#!/usr/bin/env tsx
/**
 * Removes stale `null` values for `socialLinks.[].userId`.
 *
 * Background: `socialLinkSchema.userId` was added in commit f1819b03
 * ("persist provider user id for external profile url") as `z.string().optional()`.
 * Records written before that commit may carry `userId: null` (the DB materializes
 * the previously-unset field as `null`). Output-facing schemas (posts, comments,
 * clubs, universities, user profiles) validate `socialLinks` on read, so a `null`
 * `userId` on any author triggers a `ZodError` and a 500.
 *
 * This script unsets `userId` (rather than setting it to anything) wherever it is
 * null inside `socialLinks`, matching the "field is simply absent" convention the
 * rest of the codebase uses. It also normalizes `verified: null` to absent, since
 * those are the same class of stale nullification.
 *
 * Usage:
 *   pnpm tsx scripts/fix-null-social-link-user-id.ts --dry-run   # count only
 *   pnpm tsx scripts/fix-null-social-link-user-id.ts            # apply
 */
import { MongoClient, type AnyBulkWriteOperation } from 'mongodb';

if (!('MONGODB_URI' in process.env)) {
  const dotenv = await import('dotenv');
  dotenv.config();
}

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('Error: MONGODB_URI environment variable is not set.');
  process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry-run');

interface SocialLinkDoc {
  platform: string;
  username: string;
  verified?: boolean | null;
  userId?: string | null;
}

type MongoDocument = {
  _id: unknown;
  id?: string;
  socialLinks?: SocialLinkDoc[];
  [key: string]: unknown;
};

const NUMERIC_FIELD_NAMES = ['userId', 'verified'] as const;

const hasOwn = (value: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

const stripNullishSocialLinkFields = (link: SocialLinkDoc): SocialLinkDoc => {
  const normalized = { ...link };
  for (const key of NUMERIC_FIELD_NAMES) {
    if (hasOwn(normalized, key) && (normalized[key] === null || normalized[key] === undefined)) {
      delete normalized[key];
    }
  }
  return normalized;
};

const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

const main = async () => {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const usersCollection = client.db().collection<MongoDocument>('users');

    const operations: AnyBulkWriteOperation<MongoDocument>[] = [];
    let scanned = 0;
    let fixedUsers = 0;
    let fixedLinks = 0;

    const users = await usersCollection
      .find({ socialLinks: { $exists: true, $ne: [] } })
      .project({ socialLinks: 1 })
      .toArray();

    for (const user of users) {
      scanned += 1;

      if (!Array.isArray(user.socialLinks)) continue;

      const normalizedSocialLinks = user.socialLinks.map(stripNullishSocialLinkFields);
      if (sameJson(normalizedSocialLinks, user.socialLinks)) continue;

      // Per-link write via array filters lets us unset only the null `userId`/
      // `verified` entries without rewriting other entries.
      operations.push({
        updateOne: {
          filter: { _id: user._id },
          update: {
            $set: { socialLinks: normalizedSocialLinks, updatedAt: new Date() }
          }
        }
      });

      fixedLinks += user.socialLinks.reduce(
        (count, link) => (count + (link.userId == null ? 1 : 0) + (link.verified == null ? 1 : 0)),
        0
      );
      fixedUsers += 1;
    }

    if (!DRY_RUN && operations.length > 0) {
      await usersCollection.bulkWrite(operations);
    }

    console.log(
      JSON.stringify(
        {
          dryRun: DRY_RUN,
          scanned,
          updatedDocuments: operations.length,
          fixedUsers,
          fixedLinkFields: fixedLinks
        },
        null,
        2
      )
    );

    if (DRY_RUN) {
      console.log(`\nDry run: ${fixedUsers} users / ${fixedLinks} null social-link fields to fix.`);
    } else {
      console.log(`\nCleaned ${fixedLinks} null social-link fields across ${fixedUsers} users.`);
    }
  } finally {
    await client.close();
  }
};

main().catch((error) => {
  console.error('Failed to clean nullish social-link userId fields:', error);
  process.exit(1);
});