/**
 * The admin shop tools: search a shop and roll one back to a changelog entry.
 *
 * The rollback is the only admin write that touches a user's content, so it
 * answers with a plain 404 for a missing shop or a missing changelog entry
 * instead of letting the underlying failure become a 500.
 */

import { implement } from '@orpc/server';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import type { Shop } from '$lib/types';
import { toPlainArray } from '$lib/utils';
import { requireBoundPhone } from '$lib/utils/index.server';
import { buildSearchPattern } from '$lib/utils/search';
import { applyShopRollback, UgcBlockedError } from '$lib/utils/shops/changelog.server';
import { blockedUgcMessage } from '$lib/ugc/audit.server';
import { adminContract } from '../../contracts/admin';
import type { ApiContext } from '../../context';
import { apiError } from '../../errors';
import { siteAdmin } from './shared.server';

const impl = implement(adminContract).$context<ApiContext>();

export const adminShopsImplementation = {
  /** `PUT /api/admin/shops/{id}/rollback` */
  rollbackShop: impl.rollbackShop.use(siteAdmin).handler(async ({ input, context }) => {
    const user = context.session!.user;

    requireBoundPhone(user);

    const shopId = input.id;

    try {
      const result = await applyShopRollback(
        mongo,
        shopId,
        input.targetEntryId || null,
        { id: user.id, name: user.name, image: user.image },
        {
          retention: input.retention,
          removePhotos: input.removePhotos,
          notify: input.notify
        }
      );
      return {
        success: true,
        shopId: result.shopId,
        shopName: result.shopName,
        targetEntryId: result.targetEntryId,
        appliedEntryIds: result.appliedEntryIds,
        retention: result.retention,
        removedPhotoIds: result.removedPhotoIds,
        removedPhotoEntryIds: result.removedPhotoEntryIds,
        failedPhotoIds: result.failedPhotoIds,
        notifiedUserIds: result.notifiedUserIds,
        snapshotStored: result.snapshotStored
      };
    } catch (err) {
      // Logged before anything is thrown: `apiError` never returns, so a
      // diagnostic placed after these calls would be unreachable and the
      // failure would go unrecorded.
      console.error('Failed to apply shop rollback:', err);

      if (err instanceof UgcBlockedError) {
        apiError('BAD_REQUEST', blockedUgcMessage(err.block));
      }
      // The two conditions the helper signals by message are translated so a
      // missing shop or changelog entry stays a 404 rather than a 500.
      const message = err instanceof Error ? err.message : '';
      if (message === 'Shop not found') apiError('NOT_FOUND', m.shop_not_found());
      if (message === 'Target changelog entry not found')
        apiError('NOT_FOUND', m.changelog_no_entries());

      // Anything else answers with the generic message. The underlying reason
      // is in the log above; putting it in the body would hand a caller the
      // internals of a rollback (storage paths, collection names, driver text).
      apiError('INTERNAL_SERVER_ERROR', m.internal_server_error());
    }
  }),

  /** `GET /api/admin/shops/search` */
  searchShops: impl.searchShops.use(siteAdmin).handler(async ({ input }) => {
    const q = input.q;
    const limit = 10;
    const pattern = buildSearchPattern(q);

    const db = mongo.db();

    const searchQuery = q
      ? {
          $or: [
            ...(isNaN(Number(q)) ? [] : [{ id: Number(q) }]),
            { name: { $regex: pattern, $options: 'is' } }
          ]
        }
      : {};

    const shops = (await db
      .collection<Shop>('shops')
      .find(searchQuery)
      .limit(limit)
      .project({ _id: 0, id: 1, name: 1 })
      .toArray()) as Array<{ id: number; name: string }>;

    return { shops: toPlainArray(shops) };
  })
};
