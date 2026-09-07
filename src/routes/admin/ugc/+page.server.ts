import mongo from '$lib/db/index.server';
import type { PageServerLoad } from './$types';
import {
  UGC_CONTENT_TYPES,
  type UgcContentType,
  type UgcEntryAuditStatus,
  type UgcEntryRecord,
  type UgcHashListItem
} from '$lib/ugc/types';
import { ENTRIES_COLLECTION, ugcAdminFilter } from '$lib/ugc/entries.server';
import { buildUgcHref, HASH_SUMMARY_GROUP, normalizeHashSummary } from '$lib/ugc/admin.server';

const PAGE_SIZE = 20;
const STATUSES = [
  'all',
  'pending',
  'queued',
  'pass',
  'review',
  'removed'
] as const satisfies readonly (UgcEntryAuditStatus | 'all')[];

/**
 * Details-page href that remembers the exact list view the admin came from.
 * The whole current query string is embedded in a single `back` parameter
 * (encoded), so any future list filter/search/page params are preserved
 * automatically — no per-param maintenance. The details page reads `back`
 * to render its "back to UGC list" link.
 */
const hashDetailHref = (hash: string, currentPath: string, search: string): string => {
  const base = `${currentPath.replace(/\/+$/, '')}/${hash}`;
  const query = search.startsWith('?') ? search.slice(1) : search;
  return query ? `${base}?back=${encodeURIComponent(query)}` : base;
};

export const load: PageServerLoad = async ({ url }) => {
  const search = (url.searchParams.get('search') || '').trim();
  const statusParam = url.searchParams.get('status') || 'all';
  const status = (STATUSES as readonly string[]).includes(statusParam)
    ? (statusParam as (typeof STATUSES)[number])
    : 'all';
  const typeParam = url.searchParams.get('type') || 'all';
  const type = (UGC_CONTENT_TYPES as readonly string[]).includes(typeParam)
    ? (typeParam as UgcContentType)
    : 'all';
  const currentPage = Math.max(parseInt(url.searchParams.get('page') || '1') || 1, 1);
  const skip = (currentPage - 1) * PAGE_SIZE;

  try {
    const db = mongo.db();
    const collection = db.collection<UgcEntryRecord>(ENTRIES_COLLECTION);

    // Type-option counts: distinct hashes per type under the active
    // status/search (not the type filter) — mirrors the previous UI, now
    // hash-deduplicated.
    const baseFilter = ugcAdminFilter({ status, search });
    const filter = type === 'all' ? baseFilter : { ...baseFilter, type };

    const typeCountRows = await collection
      .aggregate<{ _id: string; n: number }>(
        [
          { $match: baseFilter as never },
          { $group: { _id: { hash: '$hash', type: '$type' } } },
          { $group: { _id: '$_id.type', n: { $sum: 1 } } }
        ],
        { allowDiskUse: true }
      )
      .toArray();
    const typeCounts: Record<string, number> = {};
    for (const row of typeCountRows) typeCounts[row._id] = row.n;

    const [hashRows, totalRows] = await Promise.all([
      collection
        .aggregate<Record<string, unknown>>(
          [
            { $match: filter as never },
            { $group: HASH_SUMMARY_GROUP as never },
            { $sort: { updatedAt: -1 } },
            { $skip: skip },
            { $limit: PAGE_SIZE + 1 }
          ],
          { allowDiskUse: true }
        )
        .toArray(),
      collection
        .aggregate<{ n: number }>(
          [{ $match: filter as never }, { $group: { _id: '$hash' } }, { $count: 'n' }],
          { allowDiskUse: true }
        )
        .toArray()
    ]);

    const totalCount = totalRows[0]?.n ?? 0;
    const hasMore = hashRows.length > PAGE_SIZE;
    if (hasMore) hashRows.pop();

    const items: UgcHashListItem[] = hashRows.map((row) => ({
      ...normalizeHashSummary(row),
      href: hashDetailHref(String(row._id), url.pathname, url.search)
    }));

    // Single-occurrence hashes get a direct deep link to their live source so
    // admins can jump straight there (no details-page round trip needed).
    const singleOccurrence = items.filter(
      (item) => item.occurrences === 1 && (item.statusCounts.removed ?? 0) === 0
    );
    if (singleOccurrence.length > 0) {
      const rows = await collection
        .find({ hash: { $in: singleOccurrence.map((item) => item.hash) } })
        .toArray();
      const rowByHash = new Map(rows.map((row) => [row.hash, row]));
      await Promise.all(
        singleOccurrence.map(async (item) => {
          const row = rowByHash.get(item.hash);
          item.sourceHref = row ? await buildUgcHref(db, row) : null;
        })
      );
    }

    return { items, totalCount, currentPage, hasMore, search, status, type, typeCounts };
  } catch (err) {
    console.error('Error loading UGC content hashes:', err);
    return {
      items: [],
      totalCount: 0,
      currentPage: 1,
      hasMore: false,
      search,
      status,
      type,
      typeCounts: {}
    };
  }
};
