/**
 * Admin query layer over the `deleted_shops` archive.
 *
 * Deleting a shop copies the whole shop document into `deleted_shops` before
 * removing it from `shops` and Meilisearch, stamping on `deletedAt`, `deletedBy`
 * and — when the deletion came through the delete-request flow — a
 * `deleteRequestId` pointing back at the request that justified it. That makes
 * the archive the only place left that answers "why is this shop gone?".
 *
 * This module is read-only and admin-console only; it is never called from
 * user-facing routes.
 */

import type { Document, Filter, MongoClient } from 'mongodb';
import type { Shop } from '$lib/types';
import { escapeRegex, userLookupStages, USER_LABEL_EXPRESSION } from './query.server';

/** How an archived shop made it into the archive. */
export const DELETED_SHOP_SOURCES = ['request', 'external'] as const;
export type DeletedShopSource = (typeof DELETED_SHOP_SOURCES)[number];

/** A shop document as archived by the delete flow. */
export type DeletedShop = Shop & {
  deletedAt?: Date | null;
  /** User id of whoever approved/performed the deletion. */
  deletedBy?: string | null;
  /** Set when the deletion was approved through the delete-request flow. */
  deleteRequestId?: string | null;
};

/** The slice of the originating delete request worth showing in the admin table. */
export interface DeletedShopRequestSummary {
  id: string;
  reason: string;
  status: string;
  requestedBy: string | null;
  requestedByName: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  createdAt: Date | null;
}

export interface DeletedShopWithContext extends DeletedShop {
  /** The admin who performed the deletion. */
  deletedByUser?: {
    id?: string;
    name?: string | null;
    displayName?: string | null;
    image?: string | null;
  };
  /** Present when the archive record links back to a delete request. */
  deleteRequest?: DeletedShopRequestSummary | null;
}

export interface DeletedShopSearchQuery {
  /** Free text matched against shop name, address and delete-request id. */
  search?: string;
  /** Restrict to a single deleting admin. */
  deletedBy?: string;
  source?: DeletedShopSource;
  /** Inclusive lower bound on `deletedAt`. */
  from?: Date | null;
  /** Inclusive upper bound on `deletedAt`. */
  to?: Date | null;
  limit?: number;
  offset?: number;
}

/**
 * Build the Mongo match stage. Kept separate from the readers so the row query
 * and the facet query are guaranteed to describe the same scope.
 */
export const buildDeletedShopMatch = (query: DeletedShopSearchQuery): Filter<DeletedShop> => {
  const match: Filter<DeletedShop> = {};

  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), 'i');
    const or: Document[] = [
      { name: rx },
      { 'address.general': rx },
      { 'address.detailed': rx },
      { deleteRequestId: rx }
    ];

    // A purely numeric term should also hit the shop's numeric id, which would
    // otherwise never match a string pattern.
    const asNumber = Number(query.search);
    if (Number.isFinite(asNumber)) {
      or.push({ id: asNumber });
    }

    match.$or = or;
  }

  if (query.deletedBy) {
    match.deletedBy = query.deletedBy;
  }

  if (query.source === 'request') {
    // Records archived without a request came from an external sync process.
    match.deleteRequestId = { $nin: [null, ''] };
  } else if (query.source === 'external') {
    match.deleteRequestId = { $in: [null, ''] };
  }

  if (query.from || query.to) {
    match.deletedAt = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lte: query.to } : {})
    };
  }

  return match;
};

/**
 * Join the originating delete request so the table can show *why* a shop was
 * removed, not just that it was.
 */
const DELETE_REQUEST_LOOKUP_STAGES: Document[] = [
  {
    $lookup: {
      from: 'shop_delete_requests',
      let: { rid: '$deleteRequestId' },
      pipeline: [
        { $match: { $expr: { $eq: ['$id', '$$rid'] } } },
        {
          $project: {
            _id: 0,
            id: 1,
            reason: 1,
            status: 1,
            requestedBy: 1,
            requestedByName: 1,
            reviewedBy: 1,
            reviewNote: 1,
            createdAt: 1
          }
        }
      ],
      as: 'deleteRequestArr'
    }
  },
  { $addFields: { deleteRequest: { $arrayElemAt: ['$deleteRequestArr', 0] } } },
  { $project: { deleteRequestArr: 0 } }
];

/**
 * Newest-deletion-first page of archived shops, with the deleting admin and the
 * originating delete request resolved.
 *
 * Returns the matching row count so callers can size their pagination, plus the
 * subset of those rows that carry a delete request. The latter is counted over
 * the *narrowed* match rather than read from the facets, so the header summary
 * can never contradict the result count when a source filter is active.
 */
export const searchDeletedShops = async (
  client: MongoClient,
  query: DeletedShopSearchQuery
): Promise<{ shops: DeletedShopWithContext[]; total: number; requestCount: number }> => {
  const { limit = 20, offset = 0 } = query;
  const db = client.db();
  const collection = db.collection<DeletedShop>('deleted_shops');
  const match = buildDeletedShopMatch(query);

  const pipeline = [
    { $match: match },
    { $sort: { deletedAt: -1, id: 1 } },
    { $skip: offset },
    { $limit: limit },
    ...DELETE_REQUEST_LOOKUP_STAGES,
    ...userLookupStages('deletedBy')
  ];

  const [shops, total, requestCount] = await Promise.all([
    collection.aggregate(pipeline).toArray() as Promise<DeletedShopWithContext[]>,
    collection.countDocuments(match),
    collection.countDocuments({ $and: [match, { deleteRequestId: { $nin: [null, ''] } }] })
  ]);

  return { shops, total, requestCount };
};

export interface DeletedShopFacet {
  value: string;
  count: number;
}

export interface DeletedShopUserFacet extends DeletedShopFacet {
  userId: string;
  /** Pre-formatted, language-neutral admin label. */
  label: string;
}

export interface DeletedShopFacets {
  /** Deleting admins present in the searched scope. */
  admins: DeletedShopUserFacet[];
  /** Counts per archive source. */
  sources: DeletedShopFacet[];
  /** Newest / oldest deletion timestamps present in the searched scope. */
  newest: Date | null;
  oldest: Date | null;
}

/** Upper bounds for the facet dropdowns, so the option lists stay usable. */
const FACET_LIMITS = { admins: 60, sources: DELETED_SHOP_SOURCES.length } as const;

/**
 * Filter options for the deleted-shops browser, computed in a single `$facet`
 * pass.
 *
 * As on the changelog browser, facets are derived from the free-text scope only
 * and ignore the admin/source/date narrowing — otherwise every sibling option
 * would collapse to zero the moment one filter is applied.
 */
export const getDeletedShopFacets = async (
  client: MongoClient,
  query: Pick<DeletedShopSearchQuery, 'search'>
): Promise<DeletedShopFacets> => {
  const db = client.db();
  const collection = db.collection<DeletedShop>('deleted_shops');
  const match = buildDeletedShopMatch(query);

  const [result] = await collection
    .aggregate([
      { $match: match },
      {
        $facet: {
          admins: [
            { $group: { _id: '$deletedBy', count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } },
            { $limit: FACET_LIMITS.admins },
            {
              $lookup: {
                from: 'users',
                let: { uid: '$_id' },
                pipeline: [
                  { $match: { $expr: { $eq: ['$id', '$$uid'] } } },
                  { $project: { _id: 0, id: 1, name: 1, displayName: 1 } }
                ],
                as: 'author'
              }
            },
            { $addFields: { author: { $arrayElemAt: ['$author', 0] } } },
            { $project: { _id: 0, count: 1, userId: '$_id', label: USER_LABEL_EXPRESSION } }
          ],
          sources: [
            {
              $group: {
                _id: {
                  $cond: [
                    {
                      $and: [{ $ne: ['$deleteRequestId', null] }, { $ne: ['$deleteRequestId', ''] }]
                    },
                    'request',
                    'external'
                  ]
                },
                count: { $sum: 1 }
              }
            },
            { $sort: { count: -1, _id: 1 } },
            { $limit: FACET_LIMITS.sources }
          ],
          range: [
            {
              $group: { _id: null, newest: { $max: '$deletedAt' }, oldest: { $min: '$deletedAt' } }
            }
          ]
        }
      }
    ])
    .toArray();

  const toFacets = (rows: Array<{ _id: string | null; count: number }>): DeletedShopFacet[] =>
    rows
      .filter((row) => typeof row._id === 'string' && row._id.length > 0)
      .map((row) => ({ value: row._id as string, count: row.count }));

  const admins: DeletedShopUserFacet[] = (
    (result?.admins ?? []) as Array<{ userId: string | null; count: number; label: string | null }>
  )
    .filter((row) => typeof row.userId === 'string' && row.userId.length > 0)
    .map((row) => ({
      value: row.userId as string,
      userId: row.userId as string,
      count: row.count,
      label: row.label ?? (row.userId as string)
    }));

  return {
    admins,
    sources: toFacets(result?.sources ?? []),
    newest: result?.range?.[0]?.newest ?? null,
    oldest: result?.range?.[0]?.oldest ?? null
  };
};
