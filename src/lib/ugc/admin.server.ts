import mongo from '$lib/db/index.server';
import { ObjectId } from 'mongodb';
import { resolve } from '$app/paths';
import { ENTRIES_COLLECTION } from './entries.server';
import {
  ugcTypeKind,
  type UgcContentType,
  type UgcEntryAuditStatus,
  type UgcEntryRecord,
  type UgcHashSummary
} from './types';

/**
 * Shared admin-server helpers for the hash-centered UGC manager: deep links
 * for occurrence rows and hash-summary aggregation. Client-safe *types* live
 * in `./types`; this module is server-only.
 */

/**
 * Resolve the deep link for an occurrence, mirroring the notification
 * system's link logic: comments/deletes/attendance link to their container
 * with an anchor where supported, posts to their university/club page, and
 * profile bios to the author's profile page.
 */
export const buildUgcHref = async (
  db: ReturnType<typeof mongo.db>,
  entry: UgcEntryRecord
): Promise<string | null> => {
  switch (ugcTypeKind(entry.type)) {
    case 'shop':
      return resolve('/(main)/shops/[id]', { id: entry.refId });
    case 'delete_request':
      return resolve('/(main)/shops/delete-requests/[id]', { id: entry.refId });
    case 'attendance_report': {
      // refId is the attendance report's own ObjectId; resolve its shop.
      const report = await db
        .collection<{ shopId?: number | null }>('attendance_reports')
        .findOne({ _id: new ObjectId(entry.refId) }, { projection: { shopId: 1 } });
      return report?.shopId ? resolve('/(main)/shops/[id]', { id: String(report.shopId) }) : null;
    }
    case 'organization': {
      const isClub = await db
        .collection('clubs')
        .findOne({ id: entry.refId }, { projection: { _id: 1 } });
      return isClub
        ? resolve('/(main)/clubs/[id]', { id: entry.refId })
        : resolve('/(main)/universities/[id]', { id: entry.refId });
    }
    case 'comment': {
      const comment = await db
        .collection<{ id: string; shopId?: number; postId?: string; shopDeleteRequestId?: string }>(
          'comments'
        )
        .findOne(
          { id: entry.refId },
          { projection: { id: 1, shopId: 1, postId: 1, shopDeleteRequestId: 1 } }
        );
      if (!comment) return null;
      if (comment.shopDeleteRequestId) {
        return `${resolve('/(main)/shops/delete-requests/[id]', { id: comment.shopDeleteRequestId })}?comment=${comment.id}`;
      }
      if (comment.shopId !== undefined && comment.shopId !== null) {
        return `${resolve('/(main)/shops/[id]', { id: String(comment.shopId) })}?comment=${comment.id}`;
      }
      if (comment.postId) {
        const post = await db
          .collection<{ id: string; universityId?: string; clubId?: string }>('posts')
          .findOne({ id: comment.postId }, { projection: { id: 1, universityId: 1, clubId: 1 } });
        if (post?.universityId) {
          return `${resolve('/(main)/universities/[id]/posts/[postId]', { id: post.universityId, postId: post.id })}?comment=${comment.id}`;
        }
        if (post?.clubId) {
          return `${resolve('/(main)/clubs/[id]/posts/[postId]', { id: post.clubId, postId: post.id })}?comment=${comment.id}`;
        }
      }
      return null;
    }
    case 'post': {
      const post = await db
        .collection<{ id: string; universityId?: string; clubId?: string }>('posts')
        .findOne({ id: entry.refId }, { projection: { id: 1, universityId: 1, clubId: 1 } });
      if (post?.universityId) {
        return resolve('/(main)/universities/[id]/posts/[postId]', {
          id: post.universityId,
          postId: post.id
        });
      }
      if (post?.clubId) {
        return resolve('/(main)/clubs/[id]/posts/[postId]', {
          id: post.clubId,
          postId: post.id
        });
      }
      return null;
    }
    case 'user':
      return resolve('/(main)/users/[id]', { id: entry.refId });
    default:
      return null;
  }
};

const STATUS_FIELDS: { status: UgcEntryAuditStatus; field: string }[] = [
  { status: 'pending', field: 'pending' },
  { status: 'queued', field: 'queued' },
  { status: 'pass', field: 'pass' },
  { status: 'review', field: 'review' },
  { status: 'removed', field: 'removed' }
];

const emptyStatusCounts = (): Record<UgcEntryAuditStatus, number> => ({
  pending: 0,
  queued: 0,
  pass: 0,
  review: 0,
  removed: 0
});

/** Group expression accumulating per-status occurrence counts. */
const statusCountAccumulators: Record<string, unknown> = {};
for (const { status, field } of STATUS_FIELDS) {
  statusCountAccumulators[field] = {
    $sum: { $cond: [{ $eq: ['$auditStatus', status] }, 1, 0] }
  };
}

export const HASH_SUMMARY_GROUP: Record<string, unknown> = {
  _id: '$hash',
  occurrences: { $sum: 1 },
  types: { $addToSet: '$type' },
  updatedAt: { $max: '$updatedAt' },
  createdAt: { $min: '$createdAt' },
  text: { $first: '$text' },
  auditReason: { $first: '$auditReason' },
  auditScore: { $first: '$auditScore' },
  auditSource: { $first: '$auditSource' },
  authorName: { $first: '$authorName' },
  ...statusCountAccumulators
};

const iso = (value: unknown): string | null => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return new Date(value).toISOString();
  return null;
};

/** Map a raw hash-summary group doc into the UI shape. */
export const normalizeHashSummary = (row: Record<string, unknown>): UgcHashSummary => {
  const statusCounts = emptyStatusCounts();
  for (const { field } of STATUS_FIELDS) {
    const value = row[field];
    statusCounts[field as UgcEntryAuditStatus] = typeof value === 'number' ? value : 0;
  }
  return {
    hash: String(row._id),
    occurrences: typeof row.occurrences === 'number' ? row.occurrences : 0,
    types: (Array.isArray(row.types) ? row.types : []) as UgcContentType[],
    statusCounts,
    updatedAt: iso(row.updatedAt),
    createdAt: iso(row.createdAt),
    text: typeof row.text === 'string' ? row.text : null,
    auditReason: typeof row.auditReason === 'string' ? row.auditReason : null,
    auditScore: typeof row.auditScore === 'number' ? row.auditScore : null,
    auditSource: typeof row.auditSource === 'string' ? row.auditSource : null,
    authorName: typeof row.authorName === 'string' ? row.authorName : null
  };
};

/**
 * Aggregate the summary for a single content hash (used by the details page).
 * Returns null when the hash has no registry rows.
 */
export const loadUgcHashSummary = async (hash: string): Promise<UgcHashSummary | null> => {
  const db = mongo.db();
  const rows = await db
    .collection<UgcEntryRecord>(ENTRIES_COLLECTION)
    .aggregate<Record<string, unknown>>([{ $match: { hash } }, { $group: HASH_SUMMARY_GROUP }], {
      allowDiskUse: true
    })
    .toArray();
  return rows.length > 0 ? normalizeHashSummary(rows[0]) : null;
};
