/**
 * Database migration script: Auth.js → Better Auth
 *
 * This script transforms the existing MongoDB collections to match
 * Better Auth's expected schema. It is idempotent — safe to run multiple times.
 *
 * Usage:
 *   MONGODB_URI="mongodb://..." npx tsx scripts/migrate-to-better-auth.ts
 *
 * What it does:
 *   1. Users collection: adds createdAt/updatedAt, converts emailVerified to boolean
 *   2. Accounts collection: renames fields (provider→providerId, providerAccountId→accountId,
 *      access_token→accessToken, etc.), converts userId from ObjectId to string
 *   3. Sessions collection: drops all documents (users must re-login)
 *   4. Verification tokens: left as-is (unused)
 *
 * IMPORTANT: Back up your database before running this script.
 */

import 'dotenv/config';
import { MongoClient, ObjectId, ServerApiVersion } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI environment variable is required');
  process.exit(1);
}

async function migrate() {
  const client = new MongoClient(uri!, {
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
  });

  try {
    await client.connect();
    const db = client.db();
    console.log('Connected to MongoDB');

    // --- Users ---
    const users = db.collection('users');
    const userCount = await users.countDocuments();
    console.log(`\nMigrating ${userCount} users...`);

    let usersUpdated = 0;
    const usersCursor = users.find();
    for await (const user of usersCursor) {
      const updates: Record<string, unknown> = {};

      // Ensure id field exists as string
      if (!user.id) {
        updates.id = user._id.toString();
      }

      // Convert emailVerified from Date|null to boolean
      if (
        user.emailVerified instanceof Date ||
        user.emailVerified === null ||
        user.emailVerified === undefined
      ) {
        updates.emailVerified = !!user.emailVerified;
      }

      // Add createdAt if missing
      if (!user.createdAt) {
        updates.createdAt =
          user.joinedAt ?? (user._id instanceof ObjectId ? user._id.getTimestamp() : new Date());
      }

      // Add updatedAt if missing
      if (!user.updatedAt) {
        updates.updatedAt = user.lastActiveAt ?? new Date();
      }

      if (Object.keys(updates).length > 0) {
        await users.updateOne({ _id: user._id }, { $set: updates });
        usersUpdated++;
      }
    }
    console.log(`  Updated ${usersUpdated} users`);

    // --- Accounts ---
    const accounts = db.collection('accounts');
    const accountCount = await accounts.countDocuments();
    console.log(`\nMigrating ${accountCount} accounts...`);

    let accountsUpdated = 0;
    const accountsCursor = accounts.find();
    for await (const account of accountsCursor) {
      const sets: Record<string, unknown> = {};
      const unsets: Record<string, string> = {};

      // Ensure id field exists
      if (!account.id) {
        sets.id = account._id.toString();
      }

      // Convert userId from ObjectId to string
      if (account.userId instanceof ObjectId) {
        sets.userId = account.userId.toString();
      }

      // Rename provider → providerId (if not already renamed)
      if (account.provider && !account.providerId) {
        sets.providerId = account.provider;
        unsets.provider = '';
      }

      // Rename providerAccountId → accountId (if not already renamed)
      if (account.providerAccountId && !account.accountId) {
        sets.accountId = account.providerAccountId;
        unsets.providerAccountId = '';
      }

      // Rename snake_case token fields to camelCase
      if (account.access_token && !account.accessToken) {
        sets.accessToken = account.access_token;
        unsets.access_token = '';
      }
      if (account.refresh_token && !account.refreshToken) {
        sets.refreshToken = account.refresh_token;
        unsets.refresh_token = '';
      }
      if (account.token_type && !account.tokenType) {
        sets.tokenType = account.token_type;
        unsets.token_type = '';
      }
      if (account.id_token && !account.idToken) {
        sets.idToken = account.id_token;
        unsets.id_token = '';
      }

      // Compute accessTokenExpiresAt from expires_at if available
      if (account.expires_at && !account.accessTokenExpiresAt) {
        sets.accessTokenExpiresAt = new Date(account.expires_at * 1000);
        unsets.expires_at = '';
      }

      // Remove type field (Auth.js stores 'oauth', Better Auth doesn't use it)
      if (account.type) {
        unsets.type = '';
      }

      // Add timestamps
      if (!account.createdAt) {
        sets.createdAt = account._id instanceof ObjectId ? account._id.getTimestamp() : new Date();
      }
      if (!account.updatedAt) {
        sets.updatedAt = new Date();
      }

      const updateOp: Record<string, unknown> = {};
      if (Object.keys(sets).length > 0) updateOp.$set = sets;
      if (Object.keys(unsets).length > 0) updateOp.$unset = unsets;

      if (Object.keys(updateOp).length > 0) {
        await accounts.updateOne({ _id: account._id }, updateOp);
        accountsUpdated++;
      }
    }
    console.log(`  Updated ${accountsUpdated} accounts`);

    // --- Sessions ---
    const sessions = db.collection('sessions');
    const sessionCount = await sessions.countDocuments();
    console.log(`\nDropping ${sessionCount} sessions (users must re-login)...`);
    await sessions.deleteMany({});
    console.log('  Sessions cleared');

    // --- User additional fields defaults ---
    console.log('\nBackfilling additional field defaults for users...');
    const defaultFields = {
      isEmailPublic: false,
      isActivityPublic: true,
      isFootprintPublic: false,
      isUniversityPublic: true,
      isFrequentingArcadePublic: true,
      isStarredArcadePublic: true
    };

    let fieldsBackfilled = 0;
    for (const [field, defaultValue] of Object.entries(defaultFields)) {
      const result = await users.updateMany(
        { [field]: { $exists: false } },
        { $set: { [field]: defaultValue } }
      );
      fieldsBackfilled += result.modifiedCount;
    }
    console.log(`  Backfilled ${fieldsBackfilled} missing field values across all users`);

    // --- Summary ---
    console.log('\n--- Migration complete ---');
    console.log(`Users: ${userCount} total, ${usersUpdated} updated`);
    console.log(`Accounts: ${accountCount} total, ${accountsUpdated} updated`);
    console.log(`Sessions: ${sessionCount} dropped`);
    console.log(`Fields backfilled: ${fieldsBackfilled}`);
    console.log('\nAll users will need to re-login after deploying the new code.');
  } finally {
    await client.close();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
