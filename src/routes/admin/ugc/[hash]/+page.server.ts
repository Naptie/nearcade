import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { ENTRIES_COLLECTION } from '$lib/ugc/entries.server';
import { buildUgcHref, loadUgcHashSummary } from '$lib/ugc/admin.server';
import type {
  UgcContentType,
  UgcEntryAuditStatus,
  UgcEntryRecord,
  UgcHashSummary
} from '$lib/ugc/types';

const HASH_RE = /^[0-9a-f]{64}$/;

/** Preview length per occurrence — search/full text stays server-side. */
const PREVIEW_MAX = 600;
const PAGE_SIZE = 50;

export interface UgcOccurrenceItem {
  _id: string;
  type: UgcContentType;
  key?: string;
  refId: string;
  auditStatus: UgcEntryAuditStatus;
  auditSource?: string | null;
  auditReason?: string | null;
  auditScore?: number | null;
  authorName: string | null;
  preview: string | null;
  createdAt: string;
  updatedAt: string;
  href: string | null;
}

/**
 * Hash details page — one content hash, listing every occurrence (the
 * specific entity + field rows carrying this text) with hash-level actions
 * on top and occurrence-level actions per row.
 */
export const load: PageServerLoad = async ({ params, url }) => {
  const hash = (params.hash ?? '').toLowerCase();
  if (!HASH_RE.test(hash)) {
    error(404, m.admin_ugc_hash_not_found());
  }

  const db = mongo.db();
  const collection = db.collection<UgcEntryRecord>(ENTRIES_COLLECTION);
  const summary: UgcHashSummary | null = await loadUgcHashSummary(hash);
  if (!summary) {
    error(404, m.admin_ugc_hash_not_found());
  }

  const currentPage = Math.max(parseInt(url.searchParams.get('page') || '1') || 1, 1);
  const skip = (currentPage - 1) * PAGE_SIZE;

  const records = await collection
    .find({ hash })
    .sort({ updatedAt: -1, _id: 1 })
    .skip(skip)
    .limit(PAGE_SIZE + 1)
    .toArray();
  const hasMore = records.length > PAGE_SIZE;
  if (hasMore) records.pop();

  const occurrences: UgcOccurrenceItem[] = [];
  for (const record of records) {
    occurrences.push({
      _id: record._id,
      type: record.type,
      key: record.key,
      refId: record.refId,
      auditStatus: record.auditStatus,
      auditSource: record.auditSource ?? null,
      auditReason: record.auditReason ?? null,
      auditScore: typeof record.auditScore === 'number' ? record.auditScore : null,
      authorName: record.authorName,
      preview: record.text.slice(0, PREVIEW_MAX),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      href: await buildUgcHref(db, record)
    });
  }

  return { hash, summary, occurrences, currentPage, hasMore };
};
