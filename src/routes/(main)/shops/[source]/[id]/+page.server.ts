import { error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Shop, Comment, CommentWithAuthorAndVote } from '$lib/types';
import { toPlainObject, toPlainArray, protect } from '$lib/utils';
import mongo from '$lib/db/index.server';
import { ShopSource } from '$lib/constants';
import { getCurrentAttendance } from '$lib/utils/index.server';
import { m } from '$lib/paraglide/messages';

export const load: PageServerLoad = async ({ params, parent }) => {
  const { source: sourceRaw, id } = params;
  const source = sourceRaw.toLowerCase().trim();

  // Validate source
  if (!Object.values(ShopSource).includes(source as ShopSource)) {
    error(404, m.invalid_shop_source());
  }

  // Validate id
  const shopId = parseInt(id);
  if (isNaN(shopId)) {
    error(404, m.invalid_shop_id());
  }

  // Get session data immediately
  const { session } = await parent();

  // Stream the shop data
  const shopData = (async () => {
    try {
      const db = mongo.db();
      const shopsCollection = db.collection<Shop>('shops');

      // Find the shop by source and id
      const shop = await shopsCollection.findOne({
        source: source as ShopSource,
        id: shopId
      });

      if (!shop) {
        throw error(404, m.shop_not_found());
      }

      let userAttendance: { shop: Shop; attendedAt: Date } | null = null;
      if (session?.user?.id) {
        userAttendance = await getCurrentAttendance(session.user.id);
      }

      // Load comments for this shop
      const commentsCollection = db.collection<Comment>('comments');
      const comments = await commentsCollection
        .aggregate<CommentWithAuthorAndVote>([
          {
            $match: { shopSource: source, shopId: shopId }
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

      return {
        shop: toPlainObject(shop),
        currentAttendance: userAttendance
          ? { shop: toPlainObject(userAttendance.shop), attendedAt: userAttendance.attendedAt }
          : null,
        comments: toPlainArray(comments)
      };
    } catch (err) {
      if (err && (isHttpError(err) || isRedirect(err))) {
        throw err;
      }
      console.error('Error loading shop:', err);
      throw error(500, m.failed_to_load_shop());
    }
  })();

  return {
    shopData,
    user: session?.user
  };
};
