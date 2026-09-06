import mongo from '$lib/db/index.server';
import type { Collection } from 'mongodb';
import { normalizeUgcText, ugcTextHash } from './hash';
import {
  UGC_TYPES_BY_KIND,
  type UgcAuditOutcome,
  type UgcAuditRecord,
  type UgcContentType,
  type UgcEntryAuditSource,
  type UgcEntryAuditStatus,
  type UgcEntryRecord,
  type UgcKind
} from './types';

/**
 * Registry hub for content occurrences (`ugc_entries`). Each document is ONE
 * auditable text field of one entity, typed by the canonical content-type
 * list (`_id = ${type}:${refId}[:${key}]`, e.g. `game_name:123:20011001`,
 * `post:456:content`) and stores its normalized text + content hash once.
 * Because occurrences are content-addressed by `hash`, identical text
 * anywhere on the site is discoverable with an indexed `{ hash }` query and
 * shares the verdict in `ugc_audits` (see `applyVerdictToEntries`).
 */

export const ENTRIES_COLLECTION = 'ugc_entries';
export const AUDITS_COLLECTION = 'ugc_audits';

/** Text cap mirrors the audit pipeline's MAX_AUDITED_TEXT_LENGTH. */
export const MAX_AUDITED_TEXT_LENGTH = 8000;

export const ugcEntriesCollection = (): Collection<UgcEntryRecord> =>
  mongo.db().collection<UgcEntryRecord>(ENTRIES_COLLECTION);

/** Content-addressed audit/verdict cache (`_id` = content hash). */
export const ugcAuditsCollection = (): Collection<UgcAuditRecord> =>
  mongo.db().collection<UgcAuditRecord>(AUDITS_COLLECTION);

export const ugcEntryId = (type: UgcContentType, refId: string | number, key?: string): string =>
  key ? `${type}:${String(refId)}:${key}` : `${type}:${String(refId)}`;

/** Single-field shop keys that map 1:1 onto a content type. */
const SHOP_TOP_LEVEL_TYPES = new Set<UgcContentType>([
  'shop_name',
  'shop_description',
  'shop_address'
]);

export interface UgcOccurrenceSpec {
  type: UgcContentType;
  /** Disambiguator when an entity can carry several occurrences of a type. */
  key?: string;
}

/**
 * Resolve a write-path `(kind, fieldKey)` to the precise content type (and
 * optional key) of the occurrence. This is the single place that knows how
 * each kind's live fields are named; the standalone backfill script mirrors
 * the mapping.
 */
export const resolveUgcOccurrence = (kind: UgcKind, fieldKey: string): UgcOccurrenceSpec | null => {
  switch (kind) {
    case 'shop': {
      if (SHOP_TOP_LEVEL_TYPES.has(fieldKey as UgcContentType)) {
        return { type: fieldKey as UgcContentType };
      }
      const game = /^game_(name|version|cost|description)(?::(.+))?$/.exec(fieldKey);
      if (game?.[2]) return { type: `game_${game[1]}` as UgcContentType, key: game[2] };
      return null;
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

/** Occurrence identity within its entity — `type` alone, or `type:key`. */
const occurrenceIdentity = (type: UgcContentType, key?: string): string =>
  key ? `${type}:${key}` : type;

export const statusFromOutcome = (outcome: UgcAuditOutcome): UgcEntryAuditStatus =>
  outcome.verdict === 'block' ? 'block' : outcome.verdict === 'review' ? 'review' : 'pass';

/** Audit metadata attached to an occurrence whenever its verdict is applied. */
const auditSet = (outcome: UgcAuditOutcome, source: UgcEntryAuditSource, now: Date) => ({
  auditStatus: statusFromOutcome(outcome),
  auditSource: source,
  auditReason: outcome.reason,
  auditCategories: outcome.categories,
  auditScore: outcome.score,
  updatedAt: now
});

/**
 * Apply a verdict (content-addressed by `hash`) to every registry occurrence
 * carrying that text. Severity only ever moves a row up:
 *   pass   → fills `pending` rows only (never demotes review/block/removed)
 *   review → escalates pending/pass
 *   block  → escalates pending/pass/review; enforcement flips it to `removed`
 */
export const applyVerdictToEntries = async (
  hash: string,
  outcome: UgcAuditOutcome,
  source: UgcEntryAuditSource
): Promise<number> => {
  try {
    const now = new Date();
    const set = auditSet(outcome, source, now);
    const status = set.auditStatus;
    const collection = ugcEntriesCollection();
    let result;
    if (status === 'pass') {
      result = await collection.updateMany({ hash, auditStatus: 'pending' }, { $set: set });
    } else if (status === 'review') {
      result = await collection.updateMany(
        { hash, auditStatus: { $in: ['pending', 'pass'] } },
        { $set: set }
      );
    } else {
      // block — removed rows stay terminal.
      result = await collection.updateMany(
        { hash, auditStatus: { $in: ['pending', 'pass', 'review'] } },
        { $set: set }
      );
    }
    return result.modifiedCount;
  } catch (err) {
    console.error('[UGCEntries] Failed to apply verdict to entries:', err);
    return 0;
  }
};

export interface UgcEntryRegistration {
  kind: UgcKind;
  refId: string | number;
  /** Author user id when the kind has one; `null` for unattributed kinds. */
  createdBy?: string | null;
  authorName?: string | null;
  /**
   * Auditable field key → raw text. Keys are stable per live field
   * (e.g. `content`, `title`, `shop_name`, `game_name:<gameId>`).
   */
  fields: Record<string, string | undefined | null>;
}

/**
 * Register one entity's auditable text fields as content-occurrence rows.
 * Idempotent upserts keyed `${kind}:${refId}:${fieldKey}`:
 *  - unchanged text (same hash) is left untouched — `updatedAt` only moves
 *    when content actually changes, so re-registration never re-orders the
 *    moderation queue;
 *  - new/changed text resets the row to `pending` and inherits any cached
 *    verdict for the hash from `ugc_audits` (so identical text is judged
 *    once);
 *  - field keys that disappeared from the entity (e.g. a game was removed)
 *    drop their rows.
 *
 * Registration never throws: it is bookkeeping layered on the real write,
 * and callers must not fail their submissions over it.
 */
export const registerUgcEntry = async (registration: UgcEntryRegistration): Promise<void> => {
  const { kind, refId, createdBy = null, authorName = null, fields } = registration;
  const entityId = String(refId);

  try {
    const familyTypes = UGC_TYPES_BY_KIND[kind];
    const desired: (UgcOccurrenceSpec & { hash: string; text: string })[] = [];
    for (const [fieldKey, raw] of Object.entries(fields)) {
      const spec = resolveUgcOccurrence(kind, fieldKey);
      if (!spec) continue;
      const text = raw ? normalizeUgcText(raw) : '';
      if (!text || text.length > MAX_AUDITED_TEXT_LENGTH) continue;
      desired.push({ ...spec, hash: await ugcTextHash(text), text });
    }

    const collection = ugcEntriesCollection();
    // Existing rows for this entity *within this kind's family of types* —
    // entity ids are not globally unique across kinds.
    const existing = await collection
      .find(
        { refId: entityId, type: { $in: [...familyTypes] } },
        { projection: { _id: 1, type: 1, key: 1, hash: 1 } }
      )
      .toArray();
    const existingByIdentity = new Map(
      existing.map((row) => [occurrenceIdentity(row.type, row.key), row])
    );

    // Rows for occurrences that no longer exist on the entity are stale.
    const desiredIdentities = new Set(desired.map((d) => occurrenceIdentity(d.type, d.key)));
    const stale = existing.filter(
      (row) => !desiredIdentities.has(occurrenceIdentity(row.type, row.key))
    );
    if (stale.length > 0) {
      await collection.deleteMany({ _id: { $in: stale.map((row) => row._id) } });
    }

    const now = new Date();
    const newHashes = new Set<string>();
    for (const d of desired) {
      const identity = occurrenceIdentity(d.type, d.key);
      const prev = existingByIdentity.get(identity);
      if (prev && prev.hash === d.hash) continue; // content unchanged — keep status/timestamp

      const keyed: { key?: string } = d.key ? { key: d.key } : {};
      await collection.updateOne(
        { _id: ugcEntryId(d.type, entityId, d.key) },
        {
          $set: {
            type: d.type,
            refId: entityId,
            ...keyed,
            hash: d.hash,
            text: d.text,
            auditStatus: 'pending' as UgcEntryAuditStatus,
            updatedAt: now
          },
          $setOnInsert: { createdBy, authorName, createdAt: now },
          $unset: {
            auditSource: '',
            auditReason: '',
            auditCategories: '',
            auditScore: '',
            reviewedBy: '',
            reviewedAt: ''
          }
        },
        { upsert: true }
      );
      newHashes.add(d.hash);
    }

    // Content-addressed dedup: text identical to something already judged
    // inherits that verdict immediately (no re-audit spend). A cached block
    // is enforced in the background like any other block.
    if (newHashes.size > 0) {
      const cached = await ugcAuditsCollection()
        .find(
          { _id: { $in: [...newHashes] } },
          { projection: { verdict: 1, categories: 1, score: 1, reason: 1, source: 1 } }
        )
        .toArray();
      for (const record of cached) {
        const outcome: UgcAuditOutcome = {
          verdict: record.verdict,
          categories: record.categories ?? [],
          score: record.score ?? 0.5,
          reason: record.reason ?? ''
        };
        await applyVerdictToEntries(record._id, outcome, record.source ?? 'llm');
        if (outcome.verdict === 'block') {
          // Lazy import keeps this module's import graph acyclic.
          const { enforceUgcHash } = await import('./enforcement.server');
          void enforceUgcHash(record._id).catch((err: unknown) =>
            console.error(`[UGCEntries] Registration enforcement failed (${record._id}):`, err)
          );
        }
      }
    }
  } catch (err) {
    console.error(`[UGCEntries] Registration failed (${kind}/${entityId}):`, err);
  }
};

/**
 * Unified write-time UGC entry point: registers every auditable text field
 * of the entity as content occurrences (see registerUgcEntry). Fire-and-
 * forget — never delays or fails a submission.
 *
 * `author` accepts the session user shape (id/name/displayName); the
 * denormalized display name feeds the admin queue without a join.
 */
export const submitUgc = (
  kind: UgcKind,
  refId: string | number,
  author: { id: string; name?: string | null; displayName?: string | null } | null | undefined,
  fields: Record<string, string | undefined | null>
): void => {
  const authorName = author?.displayName || author?.name || null;
  void registerUgcEntry({ kind, refId, createdBy: author?.id ?? null, authorName, fields });
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Build the admin-list filter (type / status / free-text). The text search
 * matches occurrence content directly (`text`), plus id, type/key, author
 * and audit reason. Shared by the /admin/ugc loader and the batch-action
 * endpoint so "select all matching" always agrees with the visible list.
 */
export const ugcAdminFilter = (query: {
  type?: string;
  status?: string;
  search?: string;
}): Record<string, unknown> => {
  const filter: Record<string, unknown> = {};
  if (query.status && query.status !== 'all') filter.auditStatus = query.status;
  if (query.type && query.type !== 'all') filter.type = query.type;
  const search = query.search?.trim();
  if (search) {
    const needle = escapeRegex(search.replace(/\s+/g, ' '));
    filter.$or = [
      { refId: search },
      { text: { $regex: needle, $options: 'i' } },
      { type: { $regex: needle, $options: 'i' } },
      { key: { $regex: needle, $options: 'i' } },
      { authorName: { $regex: needle, $options: 'i' } },
      { auditReason: { $regex: needle, $options: 'i' } }
    ];
  }
  return filter;
};
