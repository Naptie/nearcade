/**
 * The shop detail: one shop, read by its id.
 */

import { implement } from '@orpc/server';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { shopResponseSchema } from '$lib/schemas/shops';
import type { Shop } from '$lib/types';
import { toShopApi } from '$lib/utils/shops/api.server';
import { apiError, rethrowApiError } from '../../errors';
import { shopsContract } from '../../contracts/shops';
import type { ApiContext } from '../../context';
import { toPlainWire } from './shared.server';

const impl = implement(shopsContract).$context<ApiContext>();

export const shopsCoreDetailImplementation = {
  /** `GET /api/shops/{id}` */
  detail: impl.detail.handler(async ({ input }) => {
    const shopId = input.id;

    try {
      const db = mongo.db();
      const shopsCollection = db.collection<Shop>('shops');

      // Find the shop by source and id
      const shop = await shopsCollection.findOne({
        id: shopId
      });

      if (!shop) {
        apiError('NOT_FOUND', m.shop_not_found());
      }

      const now = new Date();

      return toPlainWire(shopResponseSchema, {
        shop: await toShopApi(shop, { includeTimeInfo: input.includeTimeInfo, now })
      });
    } catch (err) {
      rethrowApiError(err, m.failed_to_fetch_shop());
    }
  })
};
