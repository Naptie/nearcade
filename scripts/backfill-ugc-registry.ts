#!/usr/bin/env tsx
/**
 * nearcade — UGC registry backfill
 *
 * Registers every existing piece of UGC as **content-occurrence rows** into
 * `ugc_entries`: one row per auditable text field of an entity, typed by the
 * canonical precise content-type list
 * (`_id = ${type}:${refId}[:${key}]`, e.g. `game_name:123:20011001`),
 * storing the normalized text, its content hash, and the verbatim source
 * (`rawText` — line breaks / whitespace intact, so restoring a removed field
 * can put back the author's exact formatting) once.
 *
 * Missing rows are inserted; rows whose live content drifted are refreshed
 * (resetting audit state so the new text is re-judged); identical rows only
 * get their `rawText` backfilled. No audits are dispatched, no translations
 * queued, and no live content is touched.
 *
 * After a complete successful scan, absent non-moderation occurrences and
 * audit-cache rows without a live occurrence are purged. Moderation-removed
 * rows are retained for review and restoration.
 *
 * Also reports the removed-but-persisting anomaly: rows marked `removed`
 * whose registered text STILL lives on the entity (enforcement missed them —
 * e.g. text re-submitted before the hash-unchanged re-enforcement fix, or a
 * shop changelog rollback). The run archives their verbatim text.
 *
 * Usage:
 *   pnpm register-ugc
 *   MONGODB_URI=mongodb://host pnpm register-ugc
 *   pnpm register-ugc -- --dry-run    # count/report only, no writes
 */
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { normalizeUgcText, ugcTextHash } from '../src/lib/ugc/hash';
import {
  purgeUgcAuditHashesWithoutLiveOccurrences,
  purgeUgcOccurrenceRows
} from '../src/lib/ugc/registry-purge';
import {
  MAX_AUDITED_TEXT_LENGTH,
  MAX_RAW_TEXT_LENGTH,
  resolveUgcOccurrence,
  ugcEntryId
} from '../src/lib/ugc/registry.shared';
import type { UgcAuditRecord, UgcEntryRecord, UgcKind } from '../src/lib/ugc/types';

if (!('MONGODB_URI' in process.env)) {
  const dotenv = await import('dotenv');
  dotenv.config();
}

const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://mongo:27017/?dbName=nearcade';
const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 500);

const ANOMALY_PRINT_LIMIT = 50;

interface Registration {
  kind: UgcKind;
  refId: string;
  createdBy: string | null;
  authorName: string | null;
  fields: Record<string, string>;
  /** Real content recency (live doc updatedAt ?? createdAt ?? ObjectId time)
   * — keeps the admin queue's `updatedAt` sort meaningful. */
  timestamp: Date;
}

interface KindSpec {
  collection: string;
  /** Projected doc → registration (or null to skip). */
  extract: (doc: Record<string, unknown>) => Registration[];
  /** Optional filter to limit the scan. */
  filter?: Record<string, unknown>;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Best real recency available on the live doc (updatedAt ?? createdAt ??
 * ObjectId time ?? now). Keeps the registry timestamp honest so backfills
 * never make everything look freshly created. */
const docTimestamp = (doc: Record<string, unknown>): Date => {
  const toDate = (value: unknown): Date | null => {
    if (value instanceof Date) return value;
    if (typeof value === 'string' && value) {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  };
  const fromId = doc._id instanceof ObjectId ? doc._id.getTimestamp() : null;
  return toDate(doc.updatedAt) ?? toDate(doc.createdAt) ?? fromId ?? new Date();
};

const SPECS: KindSpec[] = [
  {
    collection: 'comments',
    extract: (doc) => [
      {
        kind: 'comment',
        refId: String(doc.id),
        createdBy: text(doc.createdBy) || null,
        authorName: null,
        fields: { content: text(doc.content) },
        timestamp: docTimestamp(doc)
      }
    ]
  },
  {
    collection: 'posts',
    extract: (doc) => [
      {
        kind: 'post',
        refId: String(doc.id),
        createdBy: text(doc.createdBy) || null,
        authorName: null,
        fields: { title: text(doc.title), content: text(doc.content) },
        timestamp: docTimestamp(doc)
      }
    ]
  },
  {
    collection: 'shop_delete_requests',
    extract: (doc) => [
      {
        kind: 'delete_request',
        refId: String(doc.id),
        createdBy: text(doc.requestedBy) || null,
        authorName: text(doc.requestedByName) || null,
        fields: { reason: text(doc.reason) },
        timestamp: docTimestamp(doc)
      }
    ]
  },
  {
    collection: 'attendance_reports',
    // refId = the report's own ObjectId (each attendance note is a separate
    // content occurrence, unlike other kinds keyed by entity id).
    extract: (doc) =>
      text(doc.comment)
        ? [
            {
              kind: 'attendance_report',
              refId: String(doc._id),
              createdBy: text(doc.reportedBy) || null,
              authorName: null,
              fields: { comment: text(doc.comment) },
              timestamp: docTimestamp(doc)
            }
          ]
        : [],
    filter: { comment: { $type: 'string', $ne: '' } }
  },
  {
    collection: 'clubs',
    extract: (doc) =>
      text(doc.description)
        ? [
            {
              kind: 'organization',
              refId: String(doc.id),
              createdBy: text(doc.createdBy) || null,
              authorName: null,
              fields: { description: text(doc.description) },
              timestamp: docTimestamp(doc)
            }
          ]
        : [],
    filter: { description: { $type: 'string', $ne: '' } }
  },
  {
    collection: 'universities',
    extract: (doc) =>
      text(doc.description)
        ? [
            {
              kind: 'organization',
              refId: String(doc.id),
              createdBy: null,
              authorName: null,
              fields: { description: text(doc.description) },
              timestamp: docTimestamp(doc)
            }
          ]
        : [],
    filter: { description: { $type: 'string', $ne: '' } }
  },
  {
    collection: 'shops',
    extract: (doc) => {
      const fields: Record<string, string> = {
        shop_name: text(doc.name),
        shop_description: text(doc.comment),
        shop_address: text((doc.address as { detailed?: string } | undefined)?.detailed)
      };
      for (const game of (doc.games as Record<string, unknown>[] | undefined) ?? []) {
        const gameId = String(game.gameId);
        fields[`game_name:${gameId}`] = text(game.name);
        fields[`game_version:${gameId}`] = text(game.version);
        fields[`game_cost:${gameId}`] = text(game.cost);
        fields[`game_description:${gameId}`] = text(game.comment);
      }
      return [
        {
          kind: 'shop',
          refId: String(doc.id),
          createdBy: null,
          authorName: null,
          fields,
          timestamp: docTimestamp(doc)
        }
      ];
    }
  },
  {
    collection: 'users',
    // Profile name / displayName / bio — refId is the user's id (or Mongo
    // ObjectId hex) so enforcement can clear the matching field; author is
    // the user themselves.
    extract: (doc) => {
      const fields: Record<string, string> = {
        name: text(doc.name),
        displayName: text(doc.displayName),
        bio: text(doc.bio)
      };
      // Drop empties so we don't register blank occurrences.
      for (const key of Object.keys(fields)) {
        if (!fields[key]) delete fields[key];
      }
      if (Object.keys(fields).length === 0) return [];
      const refId = text(doc.id) || String(doc._id);
      return [
        {
          kind: 'user',
          refId,
          createdBy: refId || null,
          authorName: text(doc.displayName) || text(doc.name) || null,
          fields,
          timestamp: docTimestamp(doc)
        }
      ];
    }
  }
];

/** Expand a registration into content-occurrence docs (one per text field). */
const buildOccurrenceDocs = async (registration: Registration) => {
  const docs: Record<string, unknown>[] = [];
  for (const [fieldKey, raw] of Object.entries(registration.fields)) {
    const spec = resolveUgcOccurrence(registration.kind, fieldKey);
    if (!spec) continue;
    const text = raw ? normalizeUgcText(raw) : '';
    if (!text || text.length > MAX_AUDITED_TEXT_LENGTH) continue;
    const hash = await ugcTextHash(text);
    const doc: Record<string, unknown> = {
      _id: ugcEntryId(spec.type, registration.refId, spec.key),
      type: spec.type,
      refId: registration.refId,
      hash,
      text,
      // Verbatim source for a formatting-faithful restore — mirrors the
      // rawText capture in `registerUgcEntry`.
      rawText: raw && raw.length <= MAX_RAW_TEXT_LENGTH ? raw : text,
      createdBy: registration.createdBy,
      authorName: registration.authorName,
      createdAt: registration.timestamp,
      updatedAt: registration.timestamp
    };
    if (spec.key) doc.key = spec.key;
    docs.push(doc);
  }
  return docs;
};

/**
 * Idempotent upsert: insert missing rows; refresh text/hash/rawText/author
 * when the live content changed (resetting audit state so the new text is
 * re-judged); leave identical rows' audit state untouched while backfilling
 * their rawText.
 *
 * Pipeline update is required so `auditStatus` can compare the *previous*
 * hash. Every free-form string must go through `$literal` — values like
 * `"$2.00 / 3 songs."` would otherwise be parsed as field paths.
 */
const upsertOccurrence = (doc: Record<string, unknown>) => {
  const sameHash = { $eq: ['$hash', { $literal: doc.hash }] };
  const keep = <T>(field: string, fallback: T) => ({
    $cond: [sameHash, { $ifNull: [`$${field}`, fallback] }, fallback]
  });
  return {
    updateOne: {
      filter: { _id: doc._id as string },
      update: [
        {
          $set: {
            type: { $literal: doc.type },
            refId: { $literal: doc.refId },
            hash: { $literal: doc.hash },
            text: { $literal: doc.text },
            rawText: { $literal: doc.rawText },
            createdBy: { $literal: doc.createdBy ?? null },
            authorName: { $literal: doc.authorName ?? null },
            createdAt: { $ifNull: ['$createdAt', { $literal: doc.createdAt }] },
            updatedAt: { $literal: doc.updatedAt },
            auditStatus: keep('auditStatus', 'pending'),
            auditSource: keep('auditSource', null),
            auditReason: keep('auditReason', null),
            auditCategories: keep('auditCategories', null),
            auditScore: keep('auditScore', null),
            auditModel: keep('auditModel', null),
            ...(doc.key ? { key: { $literal: doc.key } } : {})
          }
        },
        ...(!doc.key ? [{ $unset: 'key' }] : [])
      ] as never,
      upsert: true
    }
  };
};

const backfill = async (db: Db): Promise<void> => {
  let totalInserted = 0;
  let totalUpdated = 0;
  let totalUnchanged = 0;
  let totalRawTextWrites = 0;
  const anomalies: Record<string, unknown>[] = [];
  const liveOccurrenceIds = new Set<string>();
  const liveHashes = new Set<string>();
  const replacedHashes = new Set<string>();
  const entryCollection = db.collection<UgcEntryRecord>('ugc_entries');
  const auditCollection = db.collection<UgcAuditRecord>('ugc_audits');

  for (const spec of SPECS) {
    const collection = db.collection(spec.collection);
    const cursor = collection.find(spec.filter ?? {}, { batchSize: BATCH_SIZE });
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    let rawTextWrites = 0;
    let batch: Record<string, unknown>[] = [];

    const flush = async () => {
      if (batch.length === 0) return;
      const docs = batch;
      batch = [];
      // Raw Mongo docs must first go through the spec's `extract` to become
      // registrations.
      const registrations = docs.flatMap((doc) => spec.extract(doc));
      const entries = (
        await Promise.all(registrations.map((registration) => buildOccurrenceDocs(registration)))
      ).flat();
      if (entries.length === 0) return;
      for (const entry of entries) {
        liveOccurrenceIds.add(String(entry._id));
        liveHashes.add(String(entry.hash));
      }

      // Classify against the live registry so counts are truthful in both
      // modes and removed-but-persisting rows can be spotted. Registry `_id`
      // is a string (`${type}:${refId}[:${key}]`), not ObjectId.
      const ids = entries.map((e) => String(e._id));
      const existing = await db
        .collection<UgcEntryRecord>('ugc_entries')
        .find(
          { _id: { $in: ids } },
          { projection: { _id: 1, hash: 1, auditStatus: 1, rawText: 1 } }
        )
        .toArray();
      const byId = new Map(existing.map((row) => [row._id, row]));
      for (const entry of entries) {
        const prev = byId.get(String(entry._id));
        if (prev === undefined) inserted++;
        else if (prev.hash !== entry.hash) {
          updated++;
          replacedHashes.add(prev.hash);
        } else unchanged++;
        if (prev && prev.rawText !== entry.rawText) rawTextWrites++;
        // The row is `removed` yet its registered text is still live on the
        // entity — enforcement missed it (text re-submitted before the
        // hash-unchanged re-enforcement fix, or a shop rollback). This run
        // archives the verbatim text so a restore stays formatting-faithful.
        if (prev?.auditStatus === 'removed' && prev.hash === entry.hash) {
          anomalies.push(entry);
        }
      }
      if (DRY_RUN) return;

      await entryCollection.bulkWrite(
        entries.map((doc) => upsertOccurrence(doc) as never),
        { ordered: false }
      );
    };

    for await (const doc of cursor) {
      batch.push(doc as Record<string, unknown>);
      if (batch.length >= BATCH_SIZE) await flush();
    }
    await flush();

    const verb = DRY_RUN ? 'would ' : '';
    console.log(
      `${spec.collection}: ${verb}insert ${inserted}, ${verb}update ${updated}, unchanged ${unchanged}, ` +
        `${verb}backfill rawText on ${rawTextWrites} (scanned ${inserted + updated + unchanged})`
    );
    totalInserted += inserted;
    totalUpdated += updated;
    totalUnchanged += unchanged;
    totalRawTextWrites += rawTextWrites;
  }

  const staleRows: Array<Pick<UgcEntryRecord, '_id' | 'hash'>> = [];
  const staleCursor = entryCollection.find(
    { auditStatus: { $ne: 'removed' } },
    { projection: { _id: 1, hash: 1 }, batchSize: BATCH_SIZE }
  );
  for await (const row of staleCursor) {
    if (!liveOccurrenceIds.has(row._id)) staleRows.push({ _id: row._id, hash: row.hash });
  }

  let purgedOccurrences = 0;
  for (let offset = 0; offset < staleRows.length; offset += BATCH_SIZE) {
    const result = await purgeUgcOccurrenceRows(
      entryCollection,
      auditCollection,
      staleRows.slice(offset, offset + BATCH_SIZE),
      {
        dryRun: DRY_RUN,
        purgeAuditRecords: false,
        protectModerationRemoved: true
      }
    );
    purgedOccurrences += result.occurrences;
  }

  const candidateHashes = new Set([...replacedHashes, ...staleRows.map((row) => row.hash)]);
  const auditCursor = auditCollection.find({}, { projection: { _id: 1 }, batchSize: BATCH_SIZE });
  for await (const audit of auditCursor) {
    if (!liveHashes.has(audit._id)) candidateHashes.add(audit._id);
  }
  const auditRecords = await purgeUgcAuditHashesWithoutLiveOccurrences(
    entryCollection,
    auditCollection,
    candidateHashes,
    { dryRun: DRY_RUN, ...(DRY_RUN ? { liveHashes } : {}) }
  );

  console.log(
    `\nDone.${DRY_RUN ? ' (dry run)' : ''} ` +
      `${DRY_RUN ? 'Would insert' : 'Inserted'} ${totalInserted}, ` +
      `${DRY_RUN ? 'would update' : 'updated'} ${totalUpdated}, ` +
      `unchanged ${totalUnchanged}, ` +
      `${DRY_RUN ? 'would backfill rawText on' : 'backfilled rawText on'} ${totalRawTextWrites}, ` +
      `${DRY_RUN ? 'would purge' : 'purged'} ${purgedOccurrences} stale occurrence(s), ` +
      `${DRY_RUN ? 'would clear' : 'cleared'} ${auditRecords} unreferenced audit record(s).`
  );

  if (anomalies.length > 0) {
    console.log(
      `\n⚠ ${anomalies.length} removed row(s) whose registered text still persists on the live entity` +
        ` (enforcement missed them; this run ${DRY_RUN ? 'would archive' : 'archives'} their verbatim text):`
    );
    for (const entry of anomalies.slice(0, ANOMALY_PRINT_LIMIT)) {
      const raw = String(entry.rawText ?? entry.text ?? '');
      const preview = raw.replace(/\s+/g, ' ').slice(0, 80);
      console.log(
        `  - ${String(entry._id)} author=${String(entry.authorName ?? entry.createdBy ?? '—')} ` +
          `text="${preview}${raw.length > 80 ? '…' : ''}"`
      );
    }
    if (anomalies.length > ANOMALY_PRINT_LIMIT) {
      console.log(`  … and ${anomalies.length - ANOMALY_PRINT_LIMIT} more`);
    }
  } else {
    console.log('\nNo removed-but-persisting rows found.');
  }
};

const main = async (): Promise<void> => {
  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    console.log(`Connected to ${MONGODB_URI.replace(/\/\/.*@/, '//<credentials>@')}`);
    await backfill(client.db());
  } finally {
    await client.close();
  }
};

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
