import { error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Shop } from '$lib/types';
import { toPlainObject } from '$lib/utils';
import mongo from '$lib/db/index.server';
import { ShopSource } from '$lib/constants';
import { getCurrentAttendance } from '$lib/utils/index.server';
import { m } from '$lib/paraglide/messages';

export const load: PageServerLoad = async ({ params, parent }) => {
  const { source, id } = params;

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

      return {
        shop: toPlainObject(shop),
        currentAttendance: userAttendance
          ? { shop: toPlainObject(userAttendance.shop), attendedAt: userAttendance.attendedAt }
          : null
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
