/**
 * The shop creation.
 *
 * A new shop gets its id from the shared counter and its games their ids
 * from the reserved range of that id, so the two never collide.
 */

import { implement } from '@orpc/server';
import { nanoid } from 'nanoid';
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
import { logShopChange } from '$lib/utils/shops/changelog.server';
import { computeShopDerivedFields } from '$lib/utils/shops/derived';
import { normalizeGamesForShop } from '$lib/utils/shops/games.server';
import { getNextShopId } from '$lib/utils/shops/id.server';
import { apiError, rethrowApiError } from '../../errors';
import { shopsContract } from '../../contracts/shops';
import type { ApiContext } from '../../context';
import { toPlainWire } from './shared';

const impl = implement(shopsContract).$context<ApiContext>();

export const shopsCoreCreateImplementation = {
  /** `POST /api/shops` */
  create: impl.create.handler(async ({ input, context }) => {
    // `guard: 'session'` on the contract already rejected an unauthenticated
    // request, so the session is present by construction.
    const session = context.session!;

    requireBoundPhone(session.user);

    const { name, location, openingHours, address, comment, games, isClosed, closedReason } = input;
    // `openingHours` is already canonical (schema transform lifts overnight
    // closes past midnight) and validated non-empty.

    try {
      const db = mongo.db();
      const shopsCollection = db.collection<Shop>('shops');

      const newId = await getNextShopId(db);

      const normalizedGames =
        games === undefined ? [] : normalizeGamesForShop(newId, games, { mode: 'create' });
      if (games !== undefined && !normalizedGames) {
        apiError(
          'BAD_REQUEST',
          'games must be an array of game objects with titleId, name, and version'
        );
      }

      const resolvedAddress = await resolveShopAddress({
        general: address?.general ?? [],
        detailed: address?.detailed ?? '',
        region: address?.region as string[] | undefined,
        coordinates: location?.coordinates ?? null
      });

      if (resolvedAddress.region.length === 0) {
        apiError(
          'BAD_REQUEST',
          'address.region is required; provide a leaf region ID or a complete address.general'
        );
      }

      const now = new Date();
      const trimmedClosedReason = closedReason?.trim();
      const newShopInput: Shop = {
        _id: nanoid(),
        id: newId,
        name: name.trim(),
        comment: comment ?? '',
        address: resolvedAddress,
        openingHours,
        location,
        games: normalizedGames ?? [],
        createdAt: now,
        updatedAt: now,
        ...(isClosed ? { isClosed: true } : {}),
        ...(isClosed && trimmedClosedReason ? { closedReason: trimmedClosedReason } : {})
      };

      // Derived fields (including the timezone resolved from the coordinates)
      // are computed here, at write time, so the document is complete on insert
      // and reads never have to derive anything.
      const newShop: Shop = { ...newShopInput, ...computeShopDerivedFields(newShopInput) };

      // Built by the shared helper rather than by a local literal: the local used to
      // shadow the imported `shopUgcTexts` and re-list the same four key
      // families, so `create` and `update` could register different field sets
      // for the same document while both looked correct.
      const newShopUgcTexts = shopUgcTexts(newShop);

      // Tier-0 moderation gate: reject before anything is persisted.
      const blocked = await auditUgc('shop', newShop.id, newShopUgcTexts);
      if (blocked) {
        apiError('BAD_REQUEST', blockedUgcMessage(blocked));
      }

      await shopsCollection.insertOne(newShop as Parameters<typeof shopsCollection.insertOne>[0]);

      try {
        await syncShopDocument(newShop);
      } catch (meiliErr) {
        console.error('Failed to sync new shop to Meilisearch:', meiliErr);
      }

      // Assign the nearest metro station right away so the new shop is
      // immediately discoverable via the metro arm; the full openmetro sync
      // remains the system of record.
      reassignShopTransitInBackground(mongo, newId);

      // Register entry + background pre-translation + LLM audit for the text.
      submitUgc('shop', newShop.id, session.user, newShopUgcTexts);

      try {
        await logShopChange(mongo, {
          shopId: newShop.id,
          shopName: newShop.name,
          action: 'created',
          user: {
            id: session.user.id,
            name: session.user.name,
            image: session.user.image ?? null
          },
          fieldInfo: { field: 'shop' },
          createdAt: now
        });
      } catch (logErr) {
        console.error('Failed to log shop creation changelog:', logErr);
      }

      return toPlainWire(shopResponseSchema, { shop: await toShopApi(newShop, { now }) });
    } catch (err) {
      if (err instanceof IncompleteShopRegionError) {
        apiError('BAD_REQUEST', m.shop_region_incomplete());
      }
      rethrowApiError(err, 'Failed to create shop');
    }
  })
};
