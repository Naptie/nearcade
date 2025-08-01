import { MongoClient } from 'mongodb';
import type { ChangelogEntry, University, Campus } from './types';
import crypto from 'crypto';

interface ChangelogUser {
  id: string;
  name?: string | null;
  image?: string | null;
}

interface FieldChange {
  field: string;
  oldValue?: string | null;
  newValue?: string | null;
  campusId?: string | null;
  campusName?: string | null;
}

/**
 * Log a change to the changelog
 */
export async function logChange(
  client: MongoClient,
  change: {
    type: 'university' | 'club';
    targetId: string;
    action: ChangelogEntry['action'];
    user: ChangelogUser;
    fieldInfo: ChangelogEntry['fieldInfo'];
    oldValue?: string | null;
    newValue?: string | null;
    metadata?: ChangelogEntry['metadata'];
  }
): Promise<void> {
  const db = client.db();
  const changelogCollection = db.collection<ChangelogEntry>('changelog');

  const changelogEntry: ChangelogEntry = {
    id: crypto.randomUUID(),
    type: change.type,
    targetId: change.targetId,
    action: change.action,
    fieldInfo: change.fieldInfo,
    oldValue: change.oldValue,
    newValue: change.newValue,
    metadata: change.metadata,
    userId: change.user.id,
    userName: change.user.name,
    userImage: change.user.image,
    createdAt: new Date()
  };

  await changelogCollection.insertOne(changelogEntry);
}

/**
 * Compare two objects and log changes for each field that differs
 */
export async function logUniversityChanges(
  client: MongoClient,
  universityId: string,
  oldData: Partial<University>,
  newData: Partial<University>,
  user: ChangelogUser
): Promise<void> {
  const changes: FieldChange[] = [];

  // Define fields to track
  const fieldsToTrack = [
    'name',
    'type',
    'majorCategory',
    'natureOfRunning',
    'affiliation',
    'is985',
    'is211',
    'isDoubleFirstClass',
    'description',
    'website',
    'avatarUrl',
    'backgroundColor',
    'slug'
  ] as const;

  for (const field of fieldsToTrack) {
    const oldValue = oldData[field];
    const newValue = newData[field];

    // Convert values to strings for comparison, handling special cases
    const oldStr = formatValueForComparison(oldValue);
    const newStr = formatValueForComparison(newValue);

    if (oldStr !== newStr) {
      changes.push({
        field,
        oldValue: oldStr,
        newValue: newStr
      });
    }
  }

  // Log each change separately
  for (const change of changes) {
    await logChange(client, {
      type: 'university',
      targetId: universityId,
      action: 'modified',
      user,
      fieldInfo: {
        field: change.field,
        campusId: change.campusId,
        campusName: change.campusName
      },
      oldValue: change.oldValue,
      newValue: change.newValue
    });
  }
}

/**
 * Log campus-specific changes
 */
export async function logCampusChanges(
  client: MongoClient,
  universityId: string,
  action: 'campus_added' | 'campus_updated' | 'campus_deleted',
  campus: Campus,
  user: ChangelogUser,
  oldCampusData?: Partial<Campus>
): Promise<void> {
  if (action === 'campus_added' || action === 'campus_deleted') {
    // For add/delete, log a single entry
    await logChange(client, {
      type: 'university',
      targetId: universityId,
      action,
      user,
      fieldInfo: {
        field: 'campus',
        campusId: campus.id,
        campusName: campus.name
      },
      oldValue: action === 'campus_deleted' ? campus.name : null,
      newValue: action === 'campus_added' ? campus.name : null,
      metadata: {
        campusAddress: campus.address,
        campusCity: campus.city,
        campusProvince: campus.province
      }
    });
  } else if (action === 'campus_updated' && oldCampusData) {
    // For updates, log each field that changed
    const fieldsToTrack = ['name', 'address', 'province', 'city', 'district'] as const;

    for (const field of fieldsToTrack) {
      const oldValue = oldCampusData[field];
      const newValue = campus[field];

      // Special handling for location coordinates
      if (field === 'address' && oldCampusData.location && campus.location) {
        const oldCoords = oldCampusData.location.coordinates;
        const newCoords = campus.location.coordinates;

        if (oldCoords[0] !== newCoords[0] || oldCoords[1] !== newCoords[1]) {
          await logChange(client, {
            type: 'university',
            targetId: universityId,
            action,
            user,
            fieldInfo: {
              field: 'campus.coordinates',
              campusId: campus.id,
              campusName: campus.name
            },
            oldValue: `${oldCoords[1]}, ${oldCoords[0]}`,
            newValue: `${newCoords[1]}, ${newCoords[0]}`,
            metadata: {
              oldLatitude: oldCoords[1],
              oldLongitude: oldCoords[0],
              newLatitude: newCoords[1],
              newLongitude: newCoords[0]
            }
          });
        }
      }

      const oldStr = formatValueForComparison(oldValue);
      const newStr = formatValueForComparison(newValue);

      if (oldStr !== newStr) {
        await logChange(client, {
          type: 'university',
          targetId: universityId,
          action,
          user,
          fieldInfo: {
            field: `campus.${field}`,
            campusId: campus.id,
            campusName: campus.name
          },
          oldValue: oldStr,
          newValue: newStr
        });
      }
    }
  }
}

/**
 * Format values for comparison and storage
 */
function formatValueForComparison(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'boolean') {
    return value.toString();
  }

  if (typeof value === 'string') {
    return value.trim() || null;
  }

  return String(value);
}

/**
 * Get changelog entries for a university
 */
export async function getChangelogEntries(
  client: MongoClient,
  universityId: string,
  options: {
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ entries: ChangelogEntry[]; total: number }> {
  const { limit = 50, offset = 0 } = options;

  const db = client.db();
  const changelogCollection = db.collection<ChangelogEntry>('changelog');

  const [entries, total] = await Promise.all([
    changelogCollection
      .find({
        type: 'university',
        targetId: universityId
      })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .toArray(),
    changelogCollection.countDocuments({
      type: 'university',
      targetId: universityId
    })
  ]);

  return { entries, total };
}
