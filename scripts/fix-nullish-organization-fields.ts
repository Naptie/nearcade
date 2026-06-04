#!/usr/bin/env tsx

import { MongoClient, type AnyBulkWriteOperation } from 'mongodb';
import dotenv from 'dotenv';

if (!('MONGODB_URI' in process.env)) {
  dotenv.config();
}

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('Error: MONGODB_URI environment variable is not set.');
  process.exit(1);
}

const universityFieldNames = [
  'slug',
  'backgroundColor',
  'avatarUrl',
  'avatarImageId',
  'description',
  'website',
  'postReadability',
  'postWritability',
  'studentsCount',
  'frequentingArcades',
  'clubsCount',
  'createdAt',
  'updatedAt'
] as const;

const clubFieldNames = [
  'slug',
  'description',
  'avatarUrl',
  'avatarImageId',
  'backgroundColor',
  'website',
  'membersCount',
  'createdAt',
  'updatedAt',
  'createdBy'
] as const;

const campusFieldNames = ['createdAt', 'updatedAt', 'createdBy', 'updatedBy'] as const;

type MongoDocument = {
  _id: unknown;
  id?: string;
  [key: string]: unknown;
};

const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

const collectNullishFieldNames = (value: Record<string, unknown>, keys: readonly string[]) =>
  keys.filter((key) => hasOwn(value, key) && (value[key] === null || value[key] === undefined));

const stripNullishFields = (value: Record<string, unknown>, keys: readonly string[]) => {
  const normalized = { ...value };

  for (const key of keys) {
    if (hasOwn(normalized, key) && (normalized[key] === null || normalized[key] === undefined)) {
      delete normalized[key];
    }
  }

  return normalized;
};

const buildUnsetPayload = (fieldNames: readonly string[]) =>
  Object.fromEntries(fieldNames.map((fieldName) => [fieldName, '']));

const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

const processUniversities = async (client: MongoClient) => {
  const universitiesCollection = client.db().collection<MongoDocument>('universities');
  const operations: AnyBulkWriteOperation<MongoDocument>[] = [];
  let scanned = 0;
  let topLevelFieldFixes = 0;
  let campusFixes = 0;

  const universities = await universitiesCollection.find({}).toArray();

  for (const university of universities) {
    scanned += 1;

    const nullishUniversityFields = collectNullishFieldNames(university, universityFieldNames);
    const update: Record<string, Record<string, unknown>> = {};

    if (nullishUniversityFields.length > 0) {
      update.$unset = buildUnsetPayload(nullishUniversityFields);
      topLevelFieldFixes += nullishUniversityFields.length;
    }

    if (Array.isArray(university.campuses)) {
      const normalizedCampuses = university.campuses.map((campus) =>
        campus && typeof campus === 'object'
          ? stripNullishFields(campus as Record<string, unknown>, campusFieldNames)
          : campus
      );

      if (!sameJson(normalizedCampuses, university.campuses)) {
        update.$set = {
          ...(update.$set ?? {}),
          campuses: normalizedCampuses
        };

        campusFixes += 1;
      }
    }

    if (Object.keys(update).length > 0) {
      operations.push({
        updateOne: {
          filter: { _id: university._id },
          update
        }
      });
    }
  }

  if (operations.length > 0) {
    await universitiesCollection.bulkWrite(operations);
  }

  return {
    scanned,
    updatedDocuments: operations.length,
    topLevelFieldFixes,
    campusFixes
  };
};

const processClubs = async (client: MongoClient) => {
  const clubsCollection = client.db().collection<MongoDocument>('clubs');
  const operations: AnyBulkWriteOperation<MongoDocument>[] = [];
  let scanned = 0;
  let topLevelFieldFixes = 0;

  const clubs = await clubsCollection.find({}).toArray();

  for (const club of clubs) {
    scanned += 1;

    const nullishClubFields = collectNullishFieldNames(club, clubFieldNames);
    if (nullishClubFields.length === 0) {
      continue;
    }

    operations.push({
      updateOne: {
        filter: { _id: club._id },
        update: {
          $unset: buildUnsetPayload(nullishClubFields)
        }
      }
    });
    topLevelFieldFixes += nullishClubFields.length;
  }

  if (operations.length > 0) {
    await clubsCollection.bulkWrite(operations);
  }

  return {
    scanned,
    updatedDocuments: operations.length,
    topLevelFieldFixes
  };
};

const main = async () => {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();

    const [universityResult, clubResult] = await Promise.all([
      processUniversities(client),
      processClubs(client)
    ]);

    console.log('Finished cleaning nullish organization fields.');
    console.log(
      JSON.stringify(
        {
          universities: universityResult,
          clubs: clubResult
        },
        null,
        2
      )
    );
  } finally {
    await client.close();
  }
};

main().catch((error) => {
  console.error('Failed to clean organization fields:', error);
  process.exit(1);
});
