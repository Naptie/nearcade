/**
 * The shop updates: the edit a shop may make to itself and the admin-only
 * patch.
 *
 * The games of a shop keep their ids across an edit, so the photos, the
 * changelog entries and the attendance records that point at a game stay
 * valid — the shared game helpers decide which ids are reused.
 */

import { implement } from '@orpc/server';
import mongo from '$lib/db/index.server';
import { syncShopDocument } from '$lib/db/meili.server';
import { reassignShopTransitInBackground } from '$lib/openmetro/assign.server';
import { m } from '$lib/paraglide/messages';
import { shopResponseSchema } from '$lib/schemas/shops';
import { auditUgc, blockedUgcMessage } from '$lib/ugc/audit.server';
import { submitUgc } from '$lib/ugc/entries.server';
import { shopUgcTexts } from '$lib/ugc/shop-fields.server';
import type { Shop } from '$lib/types';
import { requireBoundPhone } from '$lib/utils/index.server';
import { IncompleteShopRegionError, resolveShopAddress } from '$lib/utils/region.server';
import { toShopApi } from '$lib/utils/shops/api.server';
import { canModifyShop } from '$lib/utils/shops/authorization.server';
import { logShopFieldChanges, logShopGamesChanges } from '$lib/utils/shops/changelog.server';
import { normalizeGamesForShop } from '$lib/utils/shops/games.server';
import { apiError, rethrowApiError } from '../../errors';
import { shopsContract } from '../../contracts/shops';
import type { ApiContext } from '../../context';
import { toPlainWire } from './shared';

const impl = implement(shopsContract).$context<ApiContext>();

export const shopsCoreUpdateImplementation = {
  /** `PUT /api/shops/{id}` */
  update: impl.update.handler(async ({ input, context }) => {
    // `guard: 'session'` on the contract already rejected an unauthenticated
    // request, so the session is present by construction.
    const session = context.session!;

    requireBoundPhone(session.user);

    const shopId = input.id;
    const { name, comment, address, openingHours, location, games, isClosed, closedReason } = input;

    try {
      const db = mongo.db();
      const shopsCollection = db.collection<Shop>('shops');

      const existing = await shopsCollection.findOne({ id: shopId });
      if (!existing) {
        apiError('NOT_FOUND', m.shop_not_found());
      }

      if (!canModifyShop(existing, session.user)) {
        apiError('FORBIDDEN', m.insufficient_permissions());
      }

      const updateFields: Partial<Shop> = { updatedAt: new Date() };
      if (name !== undefined) updateFields.name = name;
      if (comment !== undefined) updateFields.comment = comment;
      if (address !== undefined) {
        const coords = (location?.coordinates ?? existing.location?.coordinates ?? null) as
          [number, number] | null;
        const regionIds = address.region;
        updateFields.address = await resolveShopAddress({
          general: address.general ?? [],
          detailed: address.detailed ?? '',
          region: regionIds,
          coordinates: coords
        });

        if (!updateFields.address.region || updateFields.address.region.length === 0) {
          apiError('BAD_REQUEST', m.shop_region_incomplete());
        }
      }
      if (openingHours !== undefined) {
        // Already canonical (schema transform lifts overnight closes past
        // midnight) and validated non-empty.
        updateFields.openingHours = openingHours;
      }
      if (location !== undefined) updateFields.location = location;

      const unsetFields: Record<string, ''> = {};
      if (isClosed !== undefined) {
        const wasClosed = Boolean(existing.isClosed);
        const willBeClosed = Boolean(isClosed);
        if (wasClosed !== willBeClosed) {
          updateFields.isClosed = willBeClosed;
        }
        if (wasClosed && !willBeClosed) {
          unsetFields.closedReason = '';
        }
      }

      const willBeClosed = isClosed !== undefined ? Boolean(isClosed) : Boolean(existing.isClosed);
      if (willBeClosed && closedReason !== undefined && !('closedReason' in unsetFields)) {
        const trimmedReason = closedReason.trim();
        const previousReason = existing.closedReason ?? '';
        if (trimmedReason !== previousReason) {
          if (trimmedReason) {
            updateFields.closedReason = trimmedReason;
          } else {
            unsetFields.closedReason = '';
          }
        }
      }

      if (games !== undefined) {
        const normalizedGames = normalizeGamesForShop(shopId, games, {
          mode: 'update',
          existingGames: existing.games ?? []
        });
        if (!normalizedGames) {
          apiError(
            'BAD_REQUEST',
            'games must be valid game objects and cannot exceed the reserved 1000 game-id slots for this shop'
          );
        }
        updateFields.games = normalizedGames;
      }

      // Tier-0 moderation gate on the merged final text, before persisting.
      const blocked = await auditUgc(
        'shop',
        shopId,
        shopUgcTexts({ ...existing, ...updateFields })
      );
      if (blocked) {
        apiError('BAD_REQUEST', blockedUgcMessage(blocked));
      }

      await shopsCollection.updateOne(
        { id: shopId },
        {
          $set: updateFields,
          ...(Object.keys(unsetFields).length > 0 ? { $unset: unsetFields } : {})
        }
      );

      // Log changes to shop changelog (non-fatal)
      const changelogUser = {
        id: session.user.id,
        name: session.user.name,
        image: session.user.image ?? null
      };
      try {
        await logShopFieldChanges(
          mongo,
          shopId,
          existing.name,
          existing,
          {
            ...updateFields,
            ...Object.fromEntries(Object.keys(unsetFields).map((field) => [field, undefined]))
          },
          changelogUser
        );
      } catch (logErr) {
        console.error('Failed to log shop field changes:', logErr);
      }
      if (updateFields.games !== undefined) {
        try {
          await logShopGamesChanges(
            mongo,
            shopId,
            updateFields.name ?? existing.name,
            existing.games ?? [],
            updateFields.games,
            changelogUser
          );
        } catch (logErr) {
          console.error('Failed to log shop games changes:', logErr);
        }
      }

      const updated = await shopsCollection.findOne({ id: shopId });

      // Refresh registry + background pre-translation for stored text.
      if (updated) {
        submitUgc('shop', shopId, session.user, shopUgcTexts(updated));

        try {
          await syncShopDocument(updated);
        } catch (meiliErr) {
          console.error('Failed to sync updated shop to Meilisearch:', meiliErr);
        }
      }

      // A location/address edit can move the shop across the metro network:
      // reassign its station immediately instead of waiting for the next
      // full openmetro sync.
      if (updateFields.location !== undefined || updateFields.address !== undefined) {
        reassignShopTransitInBackground(mongo, shopId);
      }

      return toPlainWire(shopResponseSchema, {
        shop: await toShopApi(updated!, { now: new Date() })
      });
    } catch (err) {
      if (err instanceof IncompleteShopRegionError) {
        apiError('BAD_REQUEST', m.shop_region_incomplete());
      }
      rethrowApiError(err, 'Failed to update shop');
    }
  }),

  /** `PATCH /api/shops/{id}` */
  adminUpdate: impl.adminUpdate.handler(async ({ input }) => {
    // `guard: 'site_admin'` on the contract already answered 401 without a
    // session and 403 for a non-administrator, so both decisions belong to the
    // contract rather than to this handler.
    const shopId = input.id;

    try {
      const db = mongo.db();
      const shopsCollection = db.collection<Shop>('shops');

      const existing = await shopsCollection.findOne({ id: shopId });
      if (!existing) {
        apiError('NOT_FOUND', m.shop_not_found());
      }

      const updateFields: Partial<Shop> = { updatedAt: new Date() };
      if (input.isLocked !== undefined) updateFields.isLocked = input.isLocked;

      await shopsCollection.updateOne({ id: shopId }, { $set: updateFields });

      const updated = await shopsCollection.findOne({ id: shopId });
      return toPlainWire(shopResponseSchema, {
        shop: await toShopApi(updated!, { now: new Date() })
      });
    } catch (err) {
      rethrowApiError(err, 'Failed to update shop');
    }
  })
};
