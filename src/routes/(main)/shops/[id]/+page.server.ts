import { error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Shop, Comment, CommentWithAuthorAndVote, ShopPhoto } from '$lib/types';
import type { ShopDeleteRequest } from '$lib/types/index.server';
import { toPlainObject, toPlainArray, protect } from '$lib/utils';
import mongo from '$lib/db/index.server';
import { expandShopRegions } from '$lib/utils/region.server';
import { getCurrentAttendance } from '$lib/utils/index.server';
import { m } from '$lib/paraglide/messages';
import { hydrateEntitiesWithImages } from '$lib/images/index.server';
import { attachDeleteRequestUsers } from '$lib/utils/shops/delete-request.server';
import { buildShopTimePointPreview } from '$lib/utils/shops/changelog.server';
import type { User } from '$lib/auth/types';
import { ugcFieldsForUser, withUgcTranslations } from '$lib/ugc/translate.server';
import { getLocale } from '$lib/paraglide/runtime';
import type { DeletedShop } from '$lib/utils/shops/deleted.server';

/** Deletion metadata attached to the shop when rendering an archived copy. */
export interface DeletedShopPreview {
  deletedAt: string | null;
  deletedBy: {
    id: string;
    name?: string | null;
    displayName?: string | null;
    image?: string | null;
  } | null;
  deleteRequestId: string | null;
}

/** Time-point preview metadata (`?at=<entryId>`), for the banner and the
 * admin rollback dialog. */
export interface ShopTimePointPreviewInfo {
  entryId: string;
  entryCreatedAt: string;
  entryCount: number;
  authors: { id: string; name: string | null }[];
  photoCount: number;
}

export const load: PageServerLoad = async ({ params, url, parent }) => {
  const { id } = params;

  // Validate id
  const shopId = parseInt(id);
  if (isNaN(shopId)) {
    error(404, m.invalid_shop_id());
  }

  // Get session data immediately
  const { session } = await parent();

  const db = mongo.db();
  const shopsCollection = db.collection<Shop>('shops');

  // Load the shop synchronously so SEO-critical data is in the initial HTML
  let shopSource: Shop | null = await shopsCollection.findOne({ id: shopId });

  // The shop is gone from `shops`. For site admins only, fall back to the
  // write-once `deleted_shops` archive so they can preview what was removed;
  // everyone else still gets the regular 404.
  let deletedPreview: DeletedShopPreview | null = null;
  if (!shopSource && session?.user?.userType === 'site_admin') {
    const archived = await db.collection<DeletedShop>('deleted_shops').findOne({ id: shopId });
    if (archived) {
      shopSource = archived;
      const deletedByUser = archived.deletedBy
        ? await db
            .collection<User>('users')
            .findOne(
              { id: archived.deletedBy },
              { projection: { _id: 0, id: 1, name: 1, displayName: 1, image: 1 } }
            )
        : null;
      deletedPreview = {
        deletedAt: archived.deletedAt ? archived.deletedAt.toISOString() : null,
        deletedBy: deletedByUser ?? null,
        deleteRequestId: archived.deleteRequestId || null
      };
    }
  }

  if (!shopSource) {
    error(404, m.shop_not_found());
  }
  let shop: Shop = shopSource;

  // Time-point preview: `?at=<entryId>` reconstructs the shop as it stood at
  // that changelog entry, from public ledger data only (see
  // buildShopTimePointPreview — private reversal snapshots are never read).
  // Anyone can view it; the page renders the snapshot read-only. Deleted-shop
  // archives have no live replay base, so `at` is ignored there.
  let timePointPreview: ShopTimePointPreviewInfo | null = null;
  const atEntryId = url.searchParams.get('at');
  if (atEntryId && !deletedPreview) {
    let preview: Awaited<ReturnType<typeof buildShopTimePointPreview>>;
    try {
      preview = await buildShopTimePointPreview(mongo, shopId, atEntryId);
    } catch (err) {
      if (err instanceof Error && err.message === 'Target changelog entry not found') {
        error(404, m.changelog_no_entries());
      }
      console.error('Failed to reconstruct shop time point:', err);
      throw error(500, m.failed_to_load_shop());
    }
    shop = preview.shop;
    timePointPreview = {
      entryId: preview.targetEntryId,
      entryCreatedAt: preview.targetEntryCreatedAt.toISOString(),
      entryCount: preview.entryCount,
      authors: preview.authors,
      photoCount: preview.photos.length
    };
  }

  // Historical photos: only those already uploaded at the previewed point can
  // be shown — photos deleted before it are gone from storage entirely.
  const photoTimeFilter = timePointPreview
    ? { uploadedAt: { $lte: new Date(timePointPreview.entryCreatedAt) } }
    : {};

  // Attach cached translations for the request locale, for signed-in users
  // who opted into AI translation — cache lookups only, safe on this
  // synchronous path.
  const locale = getLocale();
  const shopFields = ugcFieldsForUser(session?.user, [
    'shop_name',
    'shop_description',
    'shop_address'
  ]);
  const gameFields = ugcFieldsForUser(session?.user, [
    'game_name',
    'game_version',
    'game_description'
  ]);
  await Promise.all([
    withUgcTranslations([shop], shopFields, locale),
    withUgcTranslations(shop.games ?? [], gameFields, locale)
  ]);

  const firstPhoto = await db
    .collection<ShopPhoto>('images')
    .findOne({ shopId, ...photoTimeFilter }, { sort: { uploadedAt: -1 }, projection: { url: 1 } });

  let userAttendance: { shop: Shop; attendedAt: Date } | null = null;
  if (session?.user?.id) {
    userAttendance = await getCurrentAttendance(session.user.id);
    if (userAttendance) {
      userAttendance = {
        ...userAttendance,
        shop: await expandShopRegions(userAttendance.shop)
      };
    }
  }

  // Stream heavier/secondary data for fast first paint
  const shopData = (async () => {
    try {
      // Load comments for this shop
      const commentsCollection = db.collection<Comment>('comments');
      const comments = await commentsCollection
        .aggregate<CommentWithAuthorAndVote>([
          {
            $match: { shopId: shopId }
          },
          {
            $lookup: {
              from: 'users',
              localField: 'createdBy',
              foreignField: 'id',
              as: 'authorData'
            }
          },
          {
            $lookup: {
              from: 'comment_votes',
              localField: 'id',
              foreignField: 'commentId',
              as: 'commentVoteData'
            }
          },
          {
            $addFields: {
              author: {
                $arrayElemAt: ['$authorData', 0]
              },
              vote: {
                $arrayElemAt: [
                  {
                    $filter: {
                      input: '$commentVoteData',
                      as: 'vote',
                      cond: { $eq: ['$$vote.userId', session?.user?.id ?? ''] }
                    }
                  },
                  0
                ]
              }
            }
          },
          {
            $project: {
              authorData: 0,
              commentVoteData: 0
            }
          },
          {
            $sort: { createdAt: 1 }
          }
        ])
        .toArray()
        .then((results) => results.map((r) => ({ ...r, author: protect(r.author) })));
      const hydratedComments = await hydrateEntitiesWithImages(db, comments);

      // Load pending delete request for this shop
      const pendingDeleteRequestDoc = await db
        .collection<ShopDeleteRequest>('shop_delete_requests')
        .findOne({ shopId, photoId: { $in: [null, undefined] }, status: 'pending' });

      const pendingDeleteRequest = pendingDeleteRequestDoc
        ? (await attachDeleteRequestUsers(db, [pendingDeleteRequestDoc]))[0]
        : null;

      // Load photos (up to 20 for the carousel) with uploader data joined
      const photos = await db
        .collection<ShopPhoto>('images')
        .aggregate<ShopPhoto>([
          { $match: { shopId, ...photoTimeFilter } },
          { $sort: { uploadedAt: -1 } },
          { $limit: 20 },
          {
            $lookup: {
              from: 'users',
              let: { uid: '$uploadedBy' },
              pipeline: [
                { $match: { $expr: { $eq: ['$id', '$$uid'] } } },
                { $project: { _id: 0, id: 1, name: 1, displayName: 1, image: 1 } }
              ],
              as: 'uploaderArr'
            }
          },
          { $addFields: { uploader: { $arrayElemAt: ['$uploaderArr', 0] } } },
          { $project: { uploaderArr: 0 } }
        ])
        .toArray();

      // Load shop owner data if claimed
      let shopOwner: {
        id: string;
        name: string;
        displayName?: string | null;
        image?: string | null;
      } | null = null;
      if (shop.ownerId) {
        const ownerDoc = await db
          .collection<User>('users')
          .findOne(
            { id: shop.ownerId },
            { projection: { _id: 0, id: 1, name: 1, displayName: 1, image: 1 } }
          );
        if (ownerDoc) {
          shopOwner = ownerDoc;
        }
      }

      return {
        comments: toPlainArray(hydratedComments),
        pendingDeleteRequest: pendingDeleteRequest ? toPlainObject(pendingDeleteRequest) : null,
        photos: toPlainArray(photos),
        shopOwner
      };
    } catch (err) {
      if (err && (isHttpError(err) || isRedirect(err))) {
        throw err;
      }
      console.error('Error loading shop data:', err);
      throw error(500, m.failed_to_load_shop());
    }
  })();

  const shopWithRegions = await expandShopRegions(shop);

  return {
    shop: toPlainObject(shopWithRegions),
    firstPhoto: firstPhoto ? toPlainObject(firstPhoto) : null,
    currentAttendance: userAttendance
      ? { shop: toPlainObject(userAttendance.shop), attendedAt: userAttendance.attendedAt }
      : null,
    shopData,
    user: session?.user,
    deletedPreview,
    timePointPreview
  };
};
