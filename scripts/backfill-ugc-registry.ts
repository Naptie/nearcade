#!/usr/bin/env tsx
/**
 * nearcade — UGC registry backfill
 *
 * Registers every existing piece of UGC as **content-occurrence rows** into
 * `ugc_entries`: one row per auditable text field of an entity, typed by the
 * canonical precise content-type list
 * (`_id = ${type}:${refId}[:${key}]`, e.g. `game_name:123:20011001`),
 * storing the normalized text and its content hash once.
 *
 * Rows are only inserted when missing (re-run after dropping `ugc_entries`
 * to rebuild). Registration ONLY: no audits are dispatched, no translations
 * queued, no content touched.
 *
 * The type resolution below mirrors `resolveUgcOccurrence` in
 * `src/lib/ugc/entries.server.ts` — keep them in sync.
 *
 * Usage:
 *   pnpm backfill:ugc-registry
 *   MONGODB_URI=mongodb://host pnpm backfill:ugc-registry
 *   pnpm backfill:ugc-registry -- --dry-run    # count only, no writes
 */
import { MongoClient, ObjectId, type Db } from 'mongodb';

if (!('MONGODB_URI' in process.env)) {
  const dotenv = await import('dotenv');
  dotenv.config();
}

const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://mongo:27017/?dbName=nearcade';
const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 500);

const MAX_TEXT_LENGTH = 8000;

/** NFC + whitespace-collapsed normalization (identical to src/lib/ugc/hash.ts). */
const normalizeUgcText = (text: string): string =>
  text.normalize('NFC').replace(/\s+/g, ' ').trim();

const encoder = new TextEncoder();
const sha256Hex = async (input: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};
const ugcTextHash = (text: string) => sha256Hex(normalizeUgcText(text));

type Kind =
  'shop' | 'comment' | 'post' | 'delete_request' | 'attendance_report' | 'organization' | 'user';

type ContentType =
  | 'shop_name'
  | 'shop_address'
  | 'shop_description'
  | 'game_name'
  | 'game_version'
  | 'game_cost'
  | 'game_description'
  | 'organization_description'
  | 'post'
  | 'comment'
  | 'delete_request'
  | 'attendance_report'
  | 'bio';

interface Registration {
  kind: Kind;
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

/** Resolve a write-path (kind, fieldKey) to the precise content type. */
const resolveType = (kind: Kind, fieldKey: string): { type: ContentType; key?: string } | null => {
  switch (kind) {
    case 'shop': {
      if (
        fieldKey === 'shop_name' ||
        fieldKey === 'shop_description' ||
        fieldKey === 'shop_address'
      ) {
        return { type: fieldKey };
      }
      const game = /^game_(name|version|cost|description)(?::(.+))?$/.exec(fieldKey);
      return game?.[2] ? { type: `game_${game[1]}` as ContentType, key: game[2] } : null;
    }
    case 'organization':
      return { type: 'organization_description' };
    case 'comment':
      return { type: 'comment' };
    case 'post':
      return fieldKey === 'title' || fieldKey === 'content'
        ? { type: 'post', key: fieldKey }
        : null;
    case 'delete_request':
      return { type: 'delete_request' };
    case 'attendance_report':
      return { type: 'attendance_report' };
    case 'user':
      return fieldKey === 'bio' ? { type: 'bio' } : null;
    default:
      return null;
  }
};

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
    // Profile bios — refId is the user's Mongo ObjectId (hex) so
    // enforcement can clear `users.bio`; author = the user themselves.
    extract: (doc) => {
      const bio = text(doc.bio);
      if (!bio) return [];
      const refId = text(doc.id) || String(doc._id);
      return [
        {
          kind: 'user',
          refId,
          createdBy: refId || null,
          authorName: text(doc.displayName) || text(doc.name) || null,
          fields: { bio },
          timestamp: docTimestamp(doc)
        }
      ];
    },
    filter: { bio: { $type: 'string', $ne: '' } }
  }
];

/** Expand a registration into content-occurrence docs (one per text field). */
const buildOccurrenceDocs = async (registration: Registration) => {
  const docs: Record<string, unknown>[] = [];
  for (const [fieldKey, raw] of Object.entries(registration.fields)) {
    const spec = resolveType(registration.kind, fieldKey);
    if (!spec) continue;
    const text = raw ? normalizeUgcText(raw) : '';
    if (!text || text.length > MAX_TEXT_LENGTH) continue;
    const hash = await ugcTextHash(text);
    const doc: Record<string, unknown> = {
      _id: spec.key
        ? `${spec.type}:${registration.refId}:${spec.key}`
        : `${spec.type}:${registration.refId}`,
      type: spec.type,
      refId: registration.refId,
      hash,
      text,
      createdBy: registration.createdBy,
      authorName: registration.authorName,
      auditStatus: 'pending' as const,
      createdAt: registration.timestamp,
      updatedAt: registration.timestamp
    };
    if (spec.key) doc.key = spec.key;
    docs.push(doc);
  }
  return docs;
};

const backfill = async (db: Db): Promise<void> => {
  let totalRegistered = 0;
  let totalSkipped = 0;

  for (const spec of SPECS) {
    const collection = db.collection(spec.collection);
    const cursor = collection.find(spec.filter ?? {}, { batchSize: BATCH_SIZE });
    let registered = 0;
    let skipped = 0;
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
      if (DRY_RUN) {
        registered += entries.length;
        return;
      }
      try {
        const result = await db.collection('ugc_entries').bulkWrite(
          entries.map((doc) => ({
            insertOne: { document: doc as never }
          })),
          { ordered: false }
        );
        registered += result.insertedCount;
        skipped += entries.length - result.insertedCount;
      } catch (err) {
        // With `ordered: false` duplicate-key rejections still reject with a
        // MongoBulkWriteError whose `result.insertedCount` reflects the
        // entries that *did* land — count them and continue.
        const bulkErr = err as { result?: { insertedCount?: number } };
        const inserted = bulkErr.result?.insertedCount ?? 0;
        registered += inserted;
        skipped += entries.length - inserted;
      }
    };

    for await (const doc of cursor) {
      batch.push(doc as Record<string, unknown>);
      if (batch.length >= BATCH_SIZE) await flush();
    }
    await flush();

    console.log(
      `${spec.collection}: ${DRY_RUN ? 'would register' : 'registered'} ${registered}${
        skipped > 0 ? `, skipped ${skipped} (already registered)` : ''
      }`
    );
    totalRegistered += registered;
    totalSkipped += skipped;
  }

  console.log(
    `\nDone. ${DRY_RUN ? 'Would register' : 'Registered'} ${totalRegistered} entries` +
      `${totalSkipped > 0 ? `, skipped ${totalSkipped} existing` : ''}${DRY_RUN ? ' (dry run)' : ''}.`
  );
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
