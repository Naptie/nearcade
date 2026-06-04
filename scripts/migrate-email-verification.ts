#!/usr/bin/env tsx

import { MongoClient, ServerApiVersion } from 'mongodb';

if (!('MONGODB_URI' in process.env)) {
  const dotenv = await import('dotenv');
  dotenv.config();
}

const MONGODB_URI = process.env.MONGODB_URI;
const DRY_RUN = process.argv.includes('--dry-run');
const PLACEHOLDER_EMAIL_PATTERN = /\.nearcade$/i;

if (!MONGODB_URI) {
  console.error('MONGODB_URI environment variable is required');
  process.exit(1);
}

type UserDocument = {
  email?: string;
  emailVerified?: boolean;
};

async function migrate() {
  const client = new MongoClient(MONGODB_URI, {
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
  });

  try {
    await client.connect();

    const usersCollection = client.db().collection<UserDocument>('users');
    const filter = {
      email: {
        $type: 'string' as const,
        $not: PLACEHOLDER_EMAIL_PATTERN
      },
      emailVerified: {
        $ne: true
      }
    };

    const usersToVerify = await usersCollection.countDocuments(filter);

    if (DRY_RUN) {
      console.log('Email verification migration dry run complete.');
      console.log(`Users matching filter: ${usersToVerify}`);
      return;
    }

    const result = await usersCollection.updateMany(filter, {
      $set: {
        emailVerified: true
      }
    });

    console.log('Email verification migration complete.');
    console.log(`Users matched: ${result.matchedCount}`);
    console.log(`Users updated: ${result.modifiedCount}`);
    console.log(
      `Users remaining with placeholder emails: ${await usersCollection.countDocuments({
        email: {
          $type: 'string' as const,
          $regex: PLACEHOLDER_EMAIL_PATTERN
        }
      })}`
    );
  } finally {
    await client.close();
  }
}

migrate().catch((error) => {
  console.error('Email verification migration failed:', error);
  process.exit(1);
});
