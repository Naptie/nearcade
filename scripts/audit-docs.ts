/// <reference types="node" />
/**
 * Schema conformance audit — finds legacy documents that no longer conform to
 * the schema the app's write paths use today.
 *
 * LONG-TERM tool: re-run any time (after schema or writer changes, data
 * imports, or incident response) to catch regressions; a clean run stays
 * clean because the write paths are what it validates against.
 *
 * Read-only. For every registered collection, each document is normalized the
 * same way the API layer normalizes Mongo documents (`toPlainObject`:
 * `Date` → ISO string, `_id` → string, recursive) and then validated against
 * the zod schema that describes newly written documents:
 *
 * - collections whose documents are described by a zod schema in
 *   `src/lib/schemas/*` are validated against that schema directly;
 * - collections whose documents are only described by a TypeScript interface
 *   (the shape its writers build) are validated against a mirror schema
 *   defined below, kept in sync with the interface — including the imported
 *   `regions` hierarchy and the openmetro sync task's persisted docs;
 * - collections without any app-level document schema (better-auth's
 *   auth/session storage, whose own plugin schemas define those documents)
 *   are listed as skipped so nothing silently passes — extend the registry if
 *   one of them gains a schema.
 *
 * Top-level fields the schema doesn't know are reported as `unknown_field`
 * issues; schema-required fields that are missing or mistyped surface as
 * regular zod issues.
 *
 * Usage:
 *   pnpm exec tsx scripts/audit-docs.ts [--collection=<name>] [--out=<path>]
 *
 * Output: human summary on stdout, full details (violating document bodies
 * included) written to ./docs-report.json by default.
 */

import { writeFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';
import { z } from 'zod';

if (!('MONGODB_URI' in process.env)) {
  const dotenv = await import('dotenv');
  dotenv.config();
}

import { userSchema } from '../src/lib/schemas/common';
import {
  shopChangelogEntrySchema,
  shopDeleteRequestSchema,
  shopDeleteRequestVoteSchema,
  shopDocumentSchema
} from '../src/lib/schemas/shops';
import { commentSchema, commentVoteSchema } from '../src/lib/schemas/comments';
import { postSchema, postVoteSchema } from '../src/lib/schemas/posts';
import {
  clubMemberSchema,
  clubSchema,
  organizationChangelogEntrySchema,
  universityMemberSchema,
  universitySchema
} from '../src/lib/schemas/organizations';
import { imageAssetSchema } from '../src/lib/schemas/images';
import { announcementSchema } from '../src/lib/schemas/announcements';
import { metroStationRankingSchema } from '../src/lib/schemas/metro';
import { rankingMetricsSchema } from '../src/lib/schemas/rankings';
import { UGC_CONTENT_TYPES, UGC_KINDS } from '../src/lib/ugc/types';

// ---------------------------------------------------------------------------
// Mirror schemas for collections whose "schema" is a TypeScript interface
// maintained next to their writers. Keep these in sync with the interface —
// a mismatch here produces false positives in the audit.
// ---------------------------------------------------------------------------

/** Mirror of `AttendanceRecord` (src/lib/types/index.ts). */
const attendanceRecordMirror = z.object({
  _id: z.string().optional(),
  userId: z.string(),
  games: z.array(
    z.object({
      gameId: z.int(),
      name: z.string(),
      version: z.string()
    })
  ),
  attendedAt: z.iso.datetime(),
  leftAt: z.iso.datetime(),
  shopId: z.int()
});

/** Mirror of `AttendanceReportRecord` (src/lib/types/index.ts). */
const attendanceReportRecordMirror = z.object({
  _id: z.string().optional(),
  shopId: z.int(),
  games: z.array(
    z.object({
      gameId: z.int(),
      name: z.string(),
      version: z.string(),
      currentAttendances: z.int().min(0)
    })
  ),
  comment: z.string().nullable(),
  reportedBy: z.string(),
  reportedAt: z.iso.datetime()
});

/** Mirror of `Machine` (src/lib/types/index.ts). */
const machineMirror = z.object({
  _id: z.string().optional(),
  id: z.string(),
  name: z.string(),
  shopId: z.int(),
  ownerId: z.string().optional(),
  serialNumber: z.string(),
  apiSecret: z.string().optional(),
  isActivated: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});

/** Mirror of `Notification` (src/lib/types/index.ts). */
const notificationMirror = z.object({
  _id: z.string().optional(),
  id: z.string(),
  type: z.enum([
    'COMMENTS',
    'REPLIES',
    'POST_VOTES',
    'COMMENT_VOTES',
    'JOIN_REQUESTS',
    'SHOP_DELETE_REQUESTS',
    'SYSTEM'
  ]),
  actorUserId: z.string(),
  actorName: z.string(),
  actorDisplayName: z.string().optional(),
  actorImage: z.string().optional(),
  targetUserId: z.string(),
  createdAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable().optional(),
  content: z.string().optional(),
  postId: z.string().optional(),
  postTitle: z.string().optional(),
  commentId: z.string().optional(),
  voteType: z.enum(['upvote', 'downvote']).optional(),
  shopId: z.int().optional(),
  joinRequestId: z.string().optional(),
  joinRequestStatus: z.enum(['approved', 'rejected']).optional(),
  joinRequestType: z.enum(['university', 'club']).optional(),
  shopDeleteRequestId: z.string().optional(),
  shopDeleteRequestStatus: z.enum(['approved', 'rejected', 'deleted']).optional(),
  shopDeleteRequestType: z.enum(['shop', 'photo']).optional(),
  shopName: z.string().optional(),
  kind: z.enum(UGC_KINDS).optional(),
  contentType: z.enum(UGC_CONTENT_TYPES).optional(),
  refId: z.string().optional(),
  reason: z.string().optional(),
  reviewedBy: z.string().optional(),
  universityId: z.string().optional(),
  clubId: z.string().optional(),
  universityName: z.string().optional(),
  clubName: z.string().optional()
});

/** Mirror of `UgcEntryRecord` (src/lib/ugc/types.ts). */
const ugcEntryMirror = z.object({
  _id: z.string(),
  type: z.enum(UGC_CONTENT_TYPES),
  refId: z.string(),
  key: z.string().optional(),
  hash: z.string(),
  text: z.string(),
  // Legacy rows predating `rawText` are expected to resurface here; the
  // raw-text backfill script should have filled them (see ugc module docs).
  rawText: z.string().optional(),
  createdBy: z.string().nullable(),
  authorName: z.string().nullable(),
  auditStatus: z.enum(['pending', 'queued', 'pass', 'review', 'removed']),
  auditSource: z.enum(['llm', 'prefilter', 'manual']).nullable().optional(),
  auditReason: z.string().optional(),
  auditCategories: z.array(z.string()).optional(),
  auditScore: z.number().optional(),
  auditModel: z.string().nullable().optional(),
  reviewedBy: z.string().nullable().optional(),
  reviewedAt: z.iso.datetime().nullable().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});

/** Mirror of `UgcAuditRecord` (src/lib/ugc/types.ts). */
const ugcAuditMirror = z.object({
  _id: z.string(),
  verdict: z.enum(['pass', 'review', 'block']),
  categories: z.array(z.string()),
  score: z.number(),
  reason: z.string(),
  model: z.string().nullable(),
  source: z.enum(['prefilter', 'llm', 'manual']),
  updatedAt: z.iso.datetime()
});

/** Mirror of `Region` (src/lib/regions/types.ts) — persisted by the worldwide-regions import pipeline. */
const regionLevelValues = ['country', 'province', 'city', 'county', 'street'] as const;

const geoPointMirror = z.object({
  type: z.literal('Point'),
  coordinates: z.tuple([z.number(), z.number()])
});

const regionMirror = z.object({
  _id: z.string().optional(),
  id: z.string(),
  parentId: z.string().nullable(),
  level: z.enum(regionLevelValues),
  name: z.record(z.string(), z.string()),
  population: z.number().nullable(),
  area: z.number().nullable(),
  location: geoPointMirror.nullable(),
  _settlementType: z.string().optional(),
  _adminType: z.string().optional(),
  selectable: z.literal(false).optional(),
  _wikidataQid: z.string().optional()
});

/** Mirror of `InviteLink` (src/lib/types/index.ts). */
const inviteLinkMirror = z.object({
  _id: z.string().optional(),
  id: z.string(),
  code: z.string(),
  type: z.enum(['university', 'club']),
  targetId: z.string(),
  createdBy: z.string(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  maxUses: z.number().int().nullable().optional(),
  currentUses: z.number().int(),
  expiresAt: z.iso.datetime().nullable().optional(),
  requireApproval: z.boolean(),
  isActive: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime().optional()
});

/** Mirror of `JoinRequest` (src/lib/types/index.ts). */
const joinRequestMirror = z.object({
  _id: z.string().optional(),
  id: z.string(),
  type: z.enum(['university', 'club']),
  targetId: z.string(),
  userId: z.string(),
  requestMessage: z.string().nullable().optional(),
  status: z.enum(['pending', 'approved', 'rejected']),
  createdAt: z.iso.datetime(),
  reviewedAt: z.iso.datetime().nullable().optional(),
  reviewedBy: z.string().nullable().optional(),
  reviewNote: z.string().nullable().optional()
});

/** Mirror of `QueueRecord` (src/lib/types/index.ts) — machine queue snapshots. */
const queueRecordMirror = z.object({
  _id: z.string().optional(),
  shopId: z.number().int(),
  games: z.array(
    z.object({
      gameId: z.number().int(),
      queue: z.array(
        z.object({
          machineName: z.string(),
          position: z.number().int(),
          isPublic: z.boolean(),
          status: z.enum(['playing', 'queued', 'deferred']),
          members: z.array(z.object({ slotIndex: z.string(), userId: z.string().nullable() }))
        })
      )
    })
  ),
  updatedAt: z.iso.datetime(),
  updatedBy: z.string()
});

/** Mirror of `ShopIdCounter` (src/lib/utils/shops/id.server.ts). */
const shopIdCounterMirror = z.object({
  _id: z.string(),
  seq: z.number().int()
});

/** Mirror of `AnnouncementReadDocument` (src/lib/announcements/server.ts). */
const announcementReadStateMirror = z.object({
  _id: z.string().optional(),
  userId: z.string(),
  readThroughAt: z.iso.datetime().nullable(),
  readTokens: z.array(z.string())
});

// Metric keys mirror `DIFF_METRICS` / `COUNT_ONLY_METRICS` in
// src/lib/admin/stats-snapshots.server.ts (not imported: the module opens a
// Mongo connection at import time).
const STATS_DIFF_METRICS = [
  'users',
  'universityChangelogs',
  'clubs',
  'posts',
  'shops',
  'shopChangelogs',
  'machines',
  'images',
  'invites',
  'joinRequests',
  'oauthClients',
  'shopDeleteRequests'
] as const;
const STATS_COUNT_ONLY_METRICS = ['universities'] as const;

/** Mirror of `AdminStatsSnapshot` (src/lib/admin/stats-snapshots.server.ts). */
const adminStatsSnapshotMirror = z.object({
  _id: z.string(),
  scope: z.string(),
  date: z.string(),
  at: z.iso.datetime(),
  prevDate: z.string().nullable(),
  counts: z.object(
    Object.fromEntries(
      [...STATS_DIFF_METRICS, ...STATS_COUNT_ONLY_METRICS].map((metric) => [metric, z.number()])
    )
  ),
  added: z.object(
    Object.fromEntries(STATS_DIFF_METRICS.map((metric) => [metric, z.number().nullable()]))
  ),
  removed: z.object(
    Object.fromEntries(STATS_DIFF_METRICS.map((metric) => [metric, z.number().nullable()]))
  )
});

/** Mirror of `AdminStatsIdSet` (src/lib/admin/stats-snapshots.server.ts) — single rolling-hash doc. */
const adminStatsIdSetMirror = z.object({
  _id: z.string(),
  date: z.string(),
  hashes: z.object(
    Object.fromEntries(STATS_DIFF_METRICS.map((metric) => [metric, z.string().optional()]))
  )
});

/**
 * `deleted_shops` archive = the shop document at deletion time plus the
 * deletion stamp (`DeletedShop`, src/lib/utils/shops/deleted.server.ts).
 */
const deletedShopSchema = shopDocumentSchema.extend({
  deletedAt: z.iso.datetime().nullable().optional(),
  deletedBy: z.string().nullable().optional(),
  deleteRequestId: z.string().nullable().optional()
});

/** Mirror of `UgcTranslationRecord` (src/lib/ugc/types.ts) as written by `persistUgcTranslation`. */
const ugcTranslationMirror = z.object({
  _id: z.string(),
  hash: z.string(),
  lang: z.enum(['en', 'zh', 'ja']),
  text: z.string(),
  model: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});

// Mirrors of the openmetro sync task's persisted serving docs
// (src/lib/openmetro/schemas.ts, written only by src/lib/openmetro/sync.server.ts).
const metroStationDocMirror = z.object({
  _id: z.string(),
  networkId: z.string(),
  name: z.string(),
  names: z.object({ zh: z.string(), en: z.string() }),
  lon: z.number(),
  lat: z.number(),
  status: z.string(),
  lineIds: z.array(z.string()),
  isInterchange: z.boolean()
});

const metroLineDocMirror = z.object({
  _id: z.string(),
  networkId: z.string(),
  name: z.string(),
  names: z.object({ zh: z.string(), en: z.string() }),
  color: z.string().nullable(),
  mode: z.string(),
  loop: z.boolean(),
  shortName: z.string()
});

const metroPatternDocMirror = z.object({
  _id: z.string(),
  networkId: z.string(),
  lineId: z.string(),
  stopIds: z.array(z.string()),
  terminalStationId: z.string().nullable()
});

const metroEdgeDocMirror = z.object({
  _id: z.string(),
  networkId: z.string(),
  kind: z.enum(['ride', 'transfer']),
  from: z.string(),
  to: z.string(),
  fromStationId: z.string(),
  toStationId: z.string(),
  lineId: z.string().nullable(),
  seconds: z.number(),
  distanceKm: z.number().nullable()
});

const metroNetworkDocMirror = z.object({
  _id: z.string(),
  name: z.string(),
  names: z.object({ zh: z.string(), en: z.string() }),
  cityRegionId: z.string(),
  schemaVersion: z.number().int().optional(),
  syncedAt: z.iso.datetime().nullable(),
  stationsHash: z.string().nullable(),
  stationCount: z.number().int(),
  lastSyncedAt: z.iso.datetime()
});

/**
 * Shared bookkeeping doc of the ranking caches. The writers replace the
 * explicit `calculationStarted: undefined` with null (driver default
 * `ignoreUndefined: false` — same quirk as notifications), so the field is
 * `Date | null` in practice.
 */
const rankingsCacheMetadataMirror = z.object({
  _id: z.literal('metadata'),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  totalCount: z.number().int(),
  isCalculating: z.boolean().optional(),
  calculationStarted: z.iso.datetime().nullable().optional()
});

const metroRankingsMetadataMirror = rankingsCacheMetadataMirror.extend({
  networks: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      names: z.object({ zh: z.string(), en: z.string() }),
      stationCount: z.number().int()
    })
  )
});

/** Mirror of `CachedRanking` (= `UniversityRankingData` + rank maps, src/lib/admin/data-updates.server.ts). */
const campusRankingMirror = z.object({
  _id: z.string().optional(), // auto ObjectId: insertMany without an explicit _id
  id: z.string(),
  universityName: z.string(),
  campusName: z.string().nullable(),
  fullName: z.string(),
  type: z.string(),
  majorCategory: z.string().nullable(),
  natureOfRunning: z.string().nullable(),
  affiliation: z.string(),
  is985: z.boolean().nullable(),
  is211: z.boolean().nullable(),
  isDoubleFirstClass: z.boolean().nullable(),
  province: z.string(),
  city: z.string(),
  district: z.string().nullable(),
  address: z.string(),
  location: geoPointMirror,
  rankings: z.array(rankingMetricsSchema),
  rank: z.number().int().nullable().optional(),
  rankOrder: z.record(z.string(), z.number().int()),
  ranks: z.record(z.string(), z.number().int())
});

/** Mirror of `CachedRegionRanking` (= `RegionRankingData` + `_id` + rank maps). `regionChain` is API-only, never persisted. */
const regionRankingMirror = z.object({
  _id: z.string(),
  id: z.string(),
  level: z.enum(regionLevelValues),
  name: z.string(),
  country: z.string().nullable(),
  province: z.string().nullable(),
  city: z.string().nullable(),
  county: z.string().nullable(),
  location: geoPointMirror,
  area: z.number().nullable(),
  population: z.number().nullable(),
  shopCount: z.number().int(),
  totalMachines: z.number().int(),
  areaDensity: z.number().nullable(),
  machinesPerCapita: z.number().nullable(),
  gameSpecificMachines: z.array(z.object({ name: z.string(), quantity: z.number().int() })),
  rank: z.number().int().nullable().optional(),
  rankOrder: z.record(z.string(), z.number().int()),
  ranks: z.record(z.string(), z.number().int())
});

// Task ids mirror `DATA_UPDATE_TASK_IDS` in src/lib/admin/data-updates.server.ts
// (not imported: the module opens a Mongo connection at import time).
const ADMIN_DATA_UPDATE_TASK_IDS = [
  'university_stats',
  'campus_rankings',
  'metro_rankings',
  'region_rankings',
  'home_stats',
  'admin_stats_snapshot',
  'meilisearch',
  'openmetro_sync'
] as const;

/** Mirror of `DataUpdateTaskRecord` (src/lib/admin/data-updates.server.ts). */
const adminDataUpdateTaskMirror = z.object({
  _id: z.enum(ADMIN_DATA_UPDATE_TASK_IDS),
  status: z.enum(['idle', 'running', 'succeeded', 'failed']),
  startedAt: z.iso.datetime().nullable().optional(),
  finishedAt: z.iso.datetime().nullable().optional(),
  lastSuccessfulAt: z.iso.datetime().nullable().optional(),
  updatedAt: z.iso.datetime(),
  durationMs: z.number().nullable().optional(),
  lastError: z.string().nullable().optional(),
  progress: z.object({ processed: z.number(), total: z.number().nullable() }).nullable().optional(),
  summary: z
    .record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()]))
    .nullable()
    .optional(),
  triggerSource: z.enum(['site_admin', 'ssc', 'startup']).nullable().optional(),
  triggerUserId: z.string().nullable().optional(),
  triggerUserName: z.string().nullable().optional()
});

/**
 * Mirror of `UgcDeletedDocRecord` (src/lib/ugc/enforcement.server.ts) — the
 * moderation-deletion archive. `docs`/`related` hold verbatim snapshots of
 * live documents and are intentionally untyped, so only the envelope is
 * validated here.
 */
const ugcDeletedDocMirror = z.object({
  _id: z.string(),
  kind: z.enum(UGC_KINDS),
  refId: z.string(),
  docs: z.array(z.record(z.string(), z.unknown())),
  related: z.array(z.record(z.string(), z.unknown())),
  relatedCollection: z.enum(['comment_votes', 'post_votes']),
  archivedAt: z.iso.datetime()
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

interface RegistryEntry {
  collection: string;
  /** Schema for every document, unless `pickSchema` overrides per document. */
  schema?: z.ZodTypeAny;
  /** Where the schema lives, for the report. */
  source: string;
  /**
   * Per-document schema dispatch for mixed-shape collections (a cache
   * `metadata` bookkeeping doc plus the cached data documents).
   */
  pickSchema?: (doc: Record<string, unknown>) => z.ZodTypeAny;
}

const SCHEMA_BACKED: RegistryEntry[] = [
  {
    collection: 'shops',
    schema: shopDocumentSchema,
    source: 'src/lib/schemas/shops.ts (shopDocumentSchema)'
  },
  { collection: 'users', schema: userSchema, source: 'src/lib/schemas/common.ts (userSchema)' },
  { collection: 'posts', schema: postSchema, source: 'src/lib/schemas/posts.ts (postSchema)' },
  {
    collection: 'comments',
    schema: commentSchema,
    source: 'src/lib/schemas/comments.ts (commentSchema)'
  },
  {
    collection: 'post_votes',
    schema: postVoteSchema,
    source: 'src/lib/schemas/posts.ts (postVoteSchema)'
  },
  {
    collection: 'comment_votes',
    schema: commentVoteSchema,
    source: 'src/lib/schemas/comments.ts (commentVoteSchema)'
  },
  {
    collection: 'clubs',
    schema: clubSchema,
    source: 'src/lib/schemas/organizations.ts (clubSchema)'
  },
  {
    collection: 'universities',
    schema: universitySchema,
    source: 'src/lib/schemas/organizations.ts (universitySchema)'
  },
  {
    collection: 'university_members',
    schema: universityMemberSchema,
    source: 'src/lib/schemas/organizations.ts (universityMemberSchema)'
  },
  {
    collection: 'club_members',
    schema: clubMemberSchema,
    source: 'src/lib/schemas/organizations.ts (clubMemberSchema)'
  },
  {
    collection: 'shop_delete_requests',
    schema: shopDeleteRequestSchema,
    source: 'src/lib/schemas/shops.ts (shopDeleteRequestSchema)'
  },
  {
    collection: 'shop_delete_request_votes',
    schema: shopDeleteRequestVoteSchema,
    source: 'src/lib/schemas/shops.ts (shopDeleteRequestVoteSchema)'
  },
  {
    collection: 'images',
    schema: imageAssetSchema,
    source: 'src/lib/schemas/images.ts (imageAssetSchema)'
  },
  {
    collection: 'shop_changelog',
    schema: shopChangelogEntrySchema,
    source: 'src/lib/schemas/shops.ts (shopChangelogEntrySchema)'
  },
  {
    collection: 'changelog',
    schema: organizationChangelogEntrySchema,
    source: 'src/lib/schemas/organizations.ts (organizationChangelogEntrySchema)'
  },
  {
    collection: 'announcements',
    schema: announcementSchema,
    source: 'src/lib/schemas/announcements.ts (announcementSchema)'
  },
  {
    collection: 'attendances',
    schema: attendanceRecordMirror,
    source: 'mirror of AttendanceRecord (src/lib/types/index.ts)'
  },
  {
    collection: 'attendance_reports',
    schema: attendanceReportRecordMirror,
    source: 'mirror of AttendanceReportRecord (src/lib/types/index.ts)'
  },
  {
    collection: 'machines',
    schema: machineMirror,
    source: 'mirror of Machine (src/lib/types/index.ts)'
  },
  {
    collection: 'notifications',
    schema: notificationMirror,
    source: 'mirror of Notification (src/lib/types/index.ts)'
  },
  {
    collection: 'ugc_entries',
    schema: ugcEntryMirror,
    source: 'mirror of UgcEntryRecord (src/lib/ugc/types.ts)'
  },
  {
    collection: 'ugc_audits',
    schema: ugcAuditMirror,
    source: 'mirror of UgcAuditRecord (src/lib/ugc/types.ts)'
  },
  // ── Collections formerly skipped: each one has a backing interface/zod
  //    schema describing exactly what its writer persists. ──
  {
    collection: 'regions',
    schema: regionMirror,
    source:
      'mirror of Region (src/lib/regions/types.ts) — persisted by the worldwide-regions import pipeline'
  },
  {
    collection: 'invite_links',
    schema: inviteLinkMirror,
    source: 'mirror of InviteLink (src/lib/types/index.ts)'
  },
  {
    collection: 'join_requests',
    schema: joinRequestMirror,
    source: 'mirror of JoinRequest (src/lib/types/index.ts)'
  },
  {
    collection: 'queues',
    schema: queueRecordMirror,
    source: 'mirror of QueueRecord (src/lib/types/index.ts)'
  },
  {
    collection: 'counters',
    schema: shopIdCounterMirror,
    source: 'mirror of ShopIdCounter (src/lib/utils/shops/id.server.ts)'
  },
  {
    collection: 'announcement_read_state',
    schema: announcementReadStateMirror,
    source: 'mirror of AnnouncementReadDocument (src/lib/announcements/server.ts)'
  },
  {
    collection: 'admin_stats_snapshots',
    schema: adminStatsSnapshotMirror,
    source: 'mirror of AdminStatsSnapshot (src/lib/admin/stats-snapshots.server.ts)'
  },
  {
    collection: 'admin_stats_idset',
    schema: adminStatsIdSetMirror,
    source: 'mirror of AdminStatsIdSet (src/lib/admin/stats-snapshots.server.ts)'
  },
  {
    collection: 'deleted_shops',
    schema: deletedShopSchema,
    source:
      'shopDocumentSchema + DeletedShop archive fields (src/lib/utils/shops/deleted.server.ts)'
  },
  {
    collection: 'ugc_translations',
    schema: ugcTranslationMirror,
    source:
      'mirror of UgcTranslationRecord (src/lib/ugc/types.ts) as written by persistUgcTranslation'
  },
  {
    collection: 'metro_stations',
    schema: metroStationDocMirror,
    source: 'mirror of MetroStationDoc (src/lib/openmetro/schemas.ts)'
  },
  {
    collection: 'metro_lines',
    schema: metroLineDocMirror,
    source: 'mirror of MetroLineDoc (src/lib/openmetro/schemas.ts)'
  },
  {
    collection: 'metro_patterns',
    schema: metroPatternDocMirror,
    source: 'mirror of MetroPatternDoc (src/lib/openmetro/schemas.ts)'
  },
  {
    collection: 'metro_edges',
    schema: metroEdgeDocMirror,
    source: 'mirror of MetroEdgeDoc (src/lib/openmetro/schemas.ts)'
  },
  {
    collection: 'openmetro_networks',
    schema: metroNetworkDocMirror,
    source: 'mirror of MetroNetworkDoc (src/lib/openmetro/schemas.ts)'
  },
  {
    collection: 'metro_station_rankings',
    source:
      'metroStationRankingSchema (src/lib/schemas/metro.ts) + rebuild metadata (src/lib/openmetro/rankings.server.ts)',
    pickSchema: (doc) =>
      doc._id === 'metadata' ? metroRankingsMetadataMirror : metroStationRankingSchema
  },
  {
    collection: 'campus_rankings',
    source:
      'mirror of CachedRanking + CampusRankingsCacheMetadata (src/lib/admin/data-updates.server.ts)',
    pickSchema: (doc) =>
      doc._id === 'metadata' ? rankingsCacheMetadataMirror : campusRankingMirror
  },
  {
    collection: 'region_rankings',
    source:
      'mirror of CachedRegionRanking + RegionRankingsCacheMetadata (src/lib/admin/data-updates.server.ts)',
    pickSchema: (doc) =>
      doc._id === 'metadata' ? rankingsCacheMetadataMirror : regionRankingMirror
  },
  {
    collection: 'admin_data_updates',
    schema: adminDataUpdateTaskMirror,
    source: 'mirror of DataUpdateTaskRecord (src/lib/admin/data-updates.server.ts)'
  },
  {
    collection: 'ugc_deleted_docs',
    schema: ugcDeletedDocMirror,
    source: 'mirror of UgcDeletedDocRecord (src/lib/ugc/enforcement.server.ts)'
  }
];

// Auth/session storage is owned by better-auth, configured with `usePlural:`
// `true` (src/lib/auth/index.server.ts), so every model name pluralizes:
// oauth_client -> oauth_clients, jwks -> jwkss, verification -> verifications.
// The library's own schemas define those documents; app code only reads some
// of them. Extend this list if a collection gains an app-level schema.
const SKIPPED: Array<{ collection: string; reason: string }> = [
  { collection: 'accounts', reason: 'managed by better-auth (core account/session/user models)' },
  { collection: 'sessions', reason: 'managed by better-auth (core account/session/user models)' },
  {
    collection: 'verifications',
    reason: 'managed by better-auth (core account/session/user models)'
  },
  { collection: 'apikeys', reason: 'managed by better-auth (apiKey plugin)' },
  { collection: 'jwkss', reason: 'managed by better-auth (jwt plugin)' },
  {
    collection: 'oauth_clients',
    reason: 'managed by better-auth (oauth-provider plugin); app code only reads and deletes'
  },
  {
    collection: 'oauth_consents',
    reason: 'managed by better-auth (oauth-provider plugin); app code only reads and deletes'
  },
  { collection: 'oauth_access_tokens', reason: 'managed by better-auth (oauth-provider plugin)' },
  { collection: 'oauth_refresh_tokens', reason: 'managed by better-auth (oauth-provider plugin)' }
];

// ---------------------------------------------------------------------------
// Normalization (mirrors `toPlainObject` in src/lib/utils/index.ts)
// ---------------------------------------------------------------------------

const plainify = (value: unknown): unknown => {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(plainify);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] =
        key === '_id' && val
          ? String(val)
          : val instanceof Date
            ? val.toISOString()
            : plainify(val);
    }
    return result;
  }
  return value;
};

const isObjectSchema = (
  schema: z.ZodTypeAny
): schema is z.ZodObject & { shape: Record<string, z.ZodTypeAny> } =>
  'shape' in schema && typeof (schema as { shape?: unknown }).shape === 'object';

const formatPath = (path: PropertyKey[]): string =>
  path
    .map((segment) => (typeof segment === 'number' ? `[${segment}]` : `.${String(segment)}`))
    .join('')
    .replace(/^\./, '');

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const only = args
  .filter((arg) => arg.startsWith('--collection='))
  .map((arg) => arg.slice('--collection='.length))
  .flatMap((arg) => arg.split(','));
const outArg = args.find((arg) => arg.startsWith('--out='));
const outPath = outArg ? outArg.slice('--out='.length) : 'legacy-docs-report.json';

const registered = only.length
  ? SCHEMA_BACKED.filter((entry) => only.includes(entry.collection))
  : SCHEMA_BACKED;
const unknownFilter = only.filter(
  (name) => !SCHEMA_BACKED.some((entry) => entry.collection === name)
);
if (unknownFilter.length) {
  console.error(`Unknown collection(s) in --collection: ${unknownFilter.join(', ')}`);
  console.error(`Known collections: ${SCHEMA_BACKED.map((entry) => entry.collection).join(', ')}`);
  process.exit(1);
}

interface DocIssue {
  path: string;
  code: string;
  message: string;
}

interface DocViolation {
  index: number;
  _id: string;
  issues: DocIssue[];
  /** Full normalized document, for hand-fixing. Omitted when too many violations. */
  doc?: Record<string, unknown>;
}

interface CollectionReport {
  collection: string;
  source: string;
  total: number;
  violations: number;
  docs: DocViolation[];
}

const mongo = new MongoClient(process.env.MONGODB_URI!, { maxPoolSize: 4 });
const report: { generatedAt: string; collections: CollectionReport[]; skipped: typeof SKIPPED } = {
  generatedAt: new Date().toISOString(),
  collections: [],
  skipped: SKIPPED
};

const MAX_DOC_BODIES = 200; // beyond this, document bodies are omitted from the JSON
const MAX_ISSUES_PER_DOC = 10;

await mongo.connect();
const db = mongo.db();
console.log(`Connected to "${db.databaseName}". Auditing ${registered.length} collection(s)...\n`);

try {
  for (const entry of registered) {
    const collectionReport: CollectionReport = {
      collection: entry.collection,
      source: entry.source,
      total: 0,
      violations: 0,
      docs: []
    };

    const cursor = db.collection(entry.collection).find({}, { batchSize: 500 });

    for await (const raw of cursor) {
      collectionReport.total++;
      const plain = plainify(raw) as Record<string, unknown>;
      // Every registry entry defines either `schema` or `pickSchema`.
      const schema = (entry.pickSchema ? entry.pickSchema(plain) : entry.schema)!;
      const knownKeys = isObjectSchema(schema) ? new Set(Object.keys(schema.shape)) : null;

      const issues: DocIssue[] = [];
      const parsed = schema.safeParse(plain);
      if (!parsed.success) {
        for (const issue of parsed.error.issues.slice(0, MAX_ISSUES_PER_DOC)) {
          issues.push({
            path: formatPath(issue.path),
            code: issue.code,
            message: issue.message
          });
        }
        if (parsed.error.issues.length > MAX_ISSUES_PER_DOC) {
          issues.push({
            path: '',
            code: 'truncated',
            message: `+${parsed.error.issues.length - MAX_ISSUES_PER_DOC} more issue(s)`
          });
        }
      }

      if (knownKeys) {
        const extra = Object.keys(plain).filter((key) => !knownKeys.has(key));
        if (extra.length) {
          issues.push({
            path: '',
            code: 'unknown_field',
            message: `fields not present in the current schema: ${extra.join(', ')}`
          });
        }
      }

      if (issues.length) {
        collectionReport.violations++;
        if (collectionReport.docs.length < MAX_DOC_BODIES) {
          collectionReport.docs.push({
            index: collectionReport.total - 1,
            _id: String(plain._id),
            issues,
            doc: plain
          });
        } else {
          collectionReport.docs.push({
            index: collectionReport.total - 1,
            _id: String(plain._id),
            issues
          });
        }
      }
    }
    await cursor.close();

    report.collections.push(collectionReport);
    const flagged = collectionReport.violations
      ? `  ⚠ ${collectionReport.violations} non-conforming`
      : '  ✓ clean';
    console.log(
      `${entry.collection.padEnd(28)} ${String(collectionReport.total).padStart(7)} docs${flagged}`
    );
  }
} finally {
  await mongo.close();
}

const totalViolations = report.collections.reduce((sum, c) => sum + c.violations, 0);
const totalDocs = report.collections.reduce((sum, c) => sum + c.total, 0);

writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');

console.log('\n──────────── summary ────────────');
console.log(`collections audited : ${report.collections.length}`);
console.log(`documents scanned   : ${totalDocs}`);
console.log(`non-conforming docs : ${totalViolations}`);
console.log(`skipped collections : ${SKIPPED.length} (see report file for reasons)`);
console.log(`full report         : ${outPath}`);

if (totalViolations > 0) {
  console.log('\nOffending documents:');
  for (const collection of report.collections) {
    for (const doc of collection.docs) {
      const brief = doc.issues
        .map((issue) => `${issue.path || '(root)'}: ${issue.message}`)
        .join(' | ');
      console.log(`  ${collection.collection}/${doc._id} — ${brief}`);
    }
  }
}
