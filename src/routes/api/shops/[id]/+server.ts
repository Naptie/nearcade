import { json, error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { Shop } from '$lib/types';
import { toPlainObject } from '$lib/utils';
import mongo from '$lib/db/index.server';
import { syncShopDocument } from '$lib/db/meili.server';
import { reassignShopTransitInBackground } from '$lib/openmetro/assign.server';
import type { RequestHandler } from './$types';
import { m } from '$lib/paraglide/messages';
import { requireBoundPhone } from '$lib/utils/index.server';
import { logShopFieldChanges, logShopGamesChanges } from '$lib/utils/shops/changelog.server';
import {
  adminUpdateShopRequestSchema,
  shopDetailQuerySchema,
  shopIdParamSchema,
  shopResponseSchema,
  updateShopRequestSchema
} from '$lib/schemas/shops';
import {
  parseJsonOrError,
  parseParamsOrError,
  parseQueryOrError
} from '$lib/utils/validation.server';
import { toShopApi } from '$lib/utils/shops/api.server';
import { IncompleteShopRegionError, resolveShopAddress } from '$lib/utils/region.server';
import { canModifyShop } from '$lib/utils/shops/authorization.server';
import { auditUgc, blockedUgcMessage } from '$lib/ugc/audit.server';
import { submitUgc } from '$lib/ugc/entries.server';
import { shopUgcTexts } from '$lib/ugc/shop-fields.server';

type ParsedGameInput = {
  gameId?: number;
} & Omit<Shop['games'][number], 'gameId'>;

const parseGamesInput = (games: unknown): ParsedGameInput[] | null => {
  if (!Array.isArray(games)) return null;

  const parsed = games.map((item) => {
    if (!item || typeof item !== 'object') return null;

    const candidate = item as {
      gameId?: unknown;
      titleId?: unknown;
      name?: unknown;
      version?: unknown;
      comment?: unknown;
      quantity?: unknown;
      cost?: unknown;
    };

    if (
      typeof candidate.titleId !== 'number' ||
      !Number.isInteger(candidate.titleId) ||
      typeof candidate.name !== 'string' ||
      typeof candidate.version !== 'string'
    ) {
      return null;
    }

    return {
      gameId:
        typeof candidate.gameId === 'number' && Number.isInteger(candidate.gameId)
          ? candidate.gameId
          : undefined,
      titleId: candidate.titleId,
      name: candidate.name,
      version: candidate.version,
      comment: typeof candidate.comment === 'string' ? candidate.comment : '',
      quantity:
        typeof candidate.quantity === 'number' && Number.isFinite(candidate.quantity)
          ? Math.max(0, Math.floor(candidate.quantity))
          : 1,
      cost: typeof candidate.cost === 'string' ? candidate.cost : ''
    };
  });

  if (parsed.some((item) => item === null)) return null;
  return parsed as ParsedGameInput[];
};

const gameKey = (game: ParsedGameInput) =>
  `${game.titleId}\u0000${game.name}\u0000${game.version}\u0000${game.comment}\u0000${game.quantity}\u0000${game.cost}`;

const gameIdentityKey = (game: ParsedGameInput) =>
  `${game.titleId}\u0000${game.name}\u0000${game.version}`;

const compareGameInput = (left: ParsedGameInput, right: ParsedGameInput) => {
  return (
    left.titleId - right.titleId ||
    left.name.localeCompare(right.name) ||
    left.version.localeCompare(right.version)
  );
};

const allocateNewGameIds = (
  shopId: number,
  occupiedIds: Set<number>,
  requestedCount: number
): number[] => {
  const start = shopId * 1000;
  const end = start + 999;
  const allocated: number[] = [];

  let next = start;
  for (const id of occupiedIds) {
    if (id >= start && id <= end && id >= next) {
      next = id + 1;
    }
  }

  while (allocated.length < requestedCount && next <= end) {
    if (!occupiedIds.has(next)) {
      allocated.push(next);
      occupiedIds.add(next);
    }
    next += 1;
  }

  if (allocated.length === requestedCount) return allocated;

  for (
    let candidate = start;
    candidate <= end && allocated.length < requestedCount;
    candidate += 1
  ) {
    if (occupiedIds.has(candidate)) continue;
    allocated.push(candidate);
    occupiedIds.add(candidate);
  }

  return allocated;
};

const normalizeGamesForShopUpdate = (
  shopId: number,
  incomingGames: unknown,
  existingGames: Shop['games']
): Shop['games'] | null => {
  const parsedIncoming = parseGamesInput(incomingGames);
  if (!parsedIncoming) return null;

  const existingById = new Map<number, Shop['games'][number]>();
  const existingByKey = new Map<string, Shop['games'][number][]>();
  const existingByIdentityKey = new Map<string, Shop['games'][number][]>();
  const existingByTitleId = new Map<number, Shop['games'][number][]>();
  const consumedExistingIds = new Set<number>();

  for (const game of existingGames) {
    if (!Number.isInteger(game.gameId)) continue;
    existingById.set(game.gameId, game);

    const key = gameKey({
      titleId: game.titleId,
      name: game.name,
      version: game.version,
      comment: game.comment,
      quantity: game.quantity,
      cost: game.cost
    });
    const bucket = existingByKey.get(key);
    if (bucket) bucket.push(game);
    else existingByKey.set(key, [game]);

    const identityKey = gameIdentityKey({
      titleId: game.titleId,
      name: game.name,
      version: game.version,
      comment: game.comment,
      quantity: game.quantity,
      cost: game.cost
    });
    const identityBucket = existingByIdentityKey.get(identityKey);
    if (identityBucket) identityBucket.push(game);
    else existingByIdentityKey.set(identityKey, [game]);

    const titleBucket = existingByTitleId.get(game.titleId);
    if (titleBucket) titleBucket.push(game);
    else existingByTitleId.set(game.titleId, [game]);
  }

  const occupiedIds = new Set<number>(existingById.keys());
  const resolved = new Array<Shop['games'][number]>(parsedIncoming.length);
  const newCandidates: Array<{ index: number; game: ParsedGameInput }> = [];

  const takeUnconsumed = (
    bucket: Shop['games'][number][] | undefined
  ): Shop['games'][number] | null => {
    if (!bucket || bucket.length === 0) return null;

    while (bucket.length > 0) {
      const matched = bucket.shift()!;
      if (consumedExistingIds.has(matched.gameId)) continue;
      consumedExistingIds.add(matched.gameId);
      return matched;
    }

    return null;
  };

  const takeUniqueUnconsumed = (
    bucket: Shop['games'][number][] | undefined
  ): Shop['games'][number] | null => {
    if (!bucket || bucket.length === 0) return null;

    const candidates = bucket.filter((item) => !consumedExistingIds.has(item.gameId));
    if (candidates.length !== 1) return null;

    const matched = candidates[0];
    consumedExistingIds.add(matched.gameId);
    return matched;
  };

  for (const [index, game] of parsedIncoming.entries()) {
    if (game.gameId !== undefined) {
      const matchedById = existingById.get(game.gameId);
      if (matchedById && !consumedExistingIds.has(matchedById.gameId)) {
        consumedExistingIds.add(matchedById.gameId);
        resolved[index] = {
          ...game,
          gameId: matchedById.gameId
        };
        continue;
      }
    }

    const key = gameKey(game);
    const matchedByExact = takeUnconsumed(existingByKey.get(key));
    if (matchedByExact) {
      resolved[index] = {
        ...game,
        gameId: matchedByExact.gameId
      };
      continue;
    }

    const identityKey = gameIdentityKey(game);
    const matchedByIdentity = takeUnconsumed(existingByIdentityKey.get(identityKey));
    if (matchedByIdentity) {
      resolved[index] = {
        ...game,
        gameId: matchedByIdentity.gameId
      };
      continue;
    }

    const matchedByTitle = takeUniqueUnconsumed(existingByTitleId.get(game.titleId));
    if (matchedByTitle) {
      resolved[index] = {
        ...game,
        gameId: matchedByTitle.gameId
      };
      continue;
    }

    newCandidates.push({ index, game });
  }

  const sortedNew = [...newCandidates].sort((left, right) => {
    return compareGameInput(left.game, right.game) || left.index - right.index;
  });

  const allocatedIds = allocateNewGameIds(shopId, occupiedIds, sortedNew.length);
  if (allocatedIds.length !== sortedNew.length) {
    return null;
  }

  sortedNew.forEach((entry, offset) => {
    resolved[entry.index] = {
      ...entry.game,
      gameId: allocatedIds[offset]
    };
  });

  return resolved;
};

export const GET: RequestHandler = async ({ params, url }) => {
  const { id: shopId } = parseParamsOrError(shopIdParamSchema, params);
  const { includeTimeInfo } = parseQueryOrError(shopDetailQuerySchema, url);

  try {
    const db = mongo.db();
    const shopsCollection = db.collection<Shop>('shops');

    // Find the shop by source and id
    const shop = await shopsCollection.findOne({
      id: shopId
    });

    if (!shop) {
      error(404, m.shop_not_found());
    }

    const now = new Date();

    const response = shopResponseSchema.parse(
      toPlainObject({ shop: await toShopApi(shop, { includeTimeInfo, now }) })
    );

    return json(response);
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error fetching shop:', err);
    error(500, m.failed_to_fetch_shop());
  }
};

export const PUT: RequestHandler = async ({ params, request, locals }) => {
  const session = locals.session;
  if (!session?.user) {
    error(401, m.unauthorized());
  }

  requireBoundPhone(session.user);

  const { id: shopId } = parseParamsOrError(shopIdParamSchema, params);
  const body = await parseJsonOrError(request, updateShopRequestSchema);

  const { name, comment, address, openingHours, location, games, isClosed, closedReason } = body;

  try {
    const db = mongo.db();
    const shopsCollection = db.collection<Shop>('shops');

    const existing = await shopsCollection.findOne({ id: shopId });
    if (!existing) {
      error(404, m.shop_not_found());
    }

    if (!canModifyShop(existing, session.user)) {
      error(403, m.insufficient_permissions());
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
        error(400, m.shop_region_incomplete());
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
      const normalizedGames = normalizeGamesForShopUpdate(shopId, games, existing.games ?? []);
      if (!normalizedGames) {
        error(
          400,
          'games must be valid game objects and cannot exceed the reserved 1000 game-id slots for this shop'
        );
      }
      updateFields.games = normalizedGames;
    }

    // Tier-0 moderation gate on the merged final text, before persisting.
    const blocked = await auditUgc('shop', shopId, shopUgcTexts({ ...existing, ...updateFields }));
    if (blocked) {
      error(400, blockedUgcMessage(blocked));
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

    const response = shopResponseSchema.parse(
      toPlainObject({ shop: await toShopApi(updated!, { now: new Date() }) })
    );
    return json(response);
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    if (err instanceof IncompleteShopRegionError) {
      error(400, m.shop_region_incomplete());
    }
    console.error('Error updating shop:', err);
    error(500, 'Failed to update shop');
  }
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  const session = locals.session;
  if (!session?.user) {
    error(401, m.unauthorized());
  }

  if (session.user.userType !== 'site_admin') {
    error(403, m.access_denied());
  }

  const { id: shopId } = parseParamsOrError(shopIdParamSchema, params);
  const body = await parseJsonOrError(request, adminUpdateShopRequestSchema);

  try {
    const db = mongo.db();
    const shopsCollection = db.collection<Shop>('shops');

    const existing = await shopsCollection.findOne({ id: shopId });
    if (!existing) {
      error(404, m.shop_not_found());
    }

    const updateFields: Partial<Shop> = { updatedAt: new Date() };
    if (body.isLocked !== undefined) updateFields.isLocked = body.isLocked;

    await shopsCollection.updateOne({ id: shopId }, { $set: updateFields });

    const updated = await shopsCollection.findOne({ id: shopId });
    const response = shopResponseSchema.parse(
      toPlainObject({ shop: await toShopApi(updated!, { now: new Date() }) })
    );
    return json(response);
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error patching shop:', err);
    error(500, 'Failed to update shop');
  }
};
