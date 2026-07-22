import { error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type {
  Shop,
  Comment,
  CommentWithAuthorAndVote,
  ShopDeleteRequest,
  ShopPhoto
} from '$lib/types';
import { toPlainObject, toPlainArray, protect } from '$lib/utils';
import mongo from '$lib/db/index.server';
import { expandShopRegions } from '$lib/utils/region.server';
import { getCurrentAttendance } from '$lib/utils/index.server';
import { m } from '$lib/paraglide/messages';
import { hydrateEntitiesWithImages } from '$lib/images/index.server';
import { attachDeleteRequestRequesters } from '$lib/utils/shops/delete-request.server';
import type { User } from '$lib/auth/types';

export const load: PageServerLoad = async ({ params, parent }) => {
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
  const shop = await shopsCollection.findOne({ id: shopId });
  if (!shop) {
    error(404, m.shop_not_found());
  }

  const firstPhoto = await db
    .collection<ShopPhoto>('images')
    .findOne({ shopId }, { sort: { uploadedAt: -1 }, projection: { url: 1 } });

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
        ? (await attachDeleteRequestRequesters(db, [pendingDeleteRequestDoc]))[0]
        : null;

      // Load photos (up to 20 for the carousel) with uploader data joined
      const photos = await db
        .collection<ShopPhoto>('images')
        .aggregate<ShopPhoto>([
          { $match: { shopId } },
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
    user: session?.user
  };
};
