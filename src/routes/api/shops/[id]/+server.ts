import { json, error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { Shop } from '$lib/types';
import { getShopOpeningHours, getShopTimezone, toPlainObject } from '$lib/utils';
import mongo from '$lib/db/index.server';
import type { RequestHandler } from './$types';
import { m } from '$lib/paraglide/messages';
import { logShopFieldChanges, logShopGamesChanges } from '$lib/utils/shops/changelog.server';

const normalizeOpeningHours = (openingHours: unknown): Shop['openingHours'] | null => {
  if (!Array.isArray(openingHours) || openingHours.length === 0) return null;

  const normalizeTime = (value: unknown) => {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as { hour?: unknown; minute?: unknown };
    if (typeof candidate.hour !== 'number' || typeof candidate.minute !== 'number') return null;
    return {
      hour: Math.max(0, Math.min(23, Math.floor(candidate.hour))),
      minute: Math.max(0, Math.min(59, Math.floor(candidate.minute)))
    };
  };

  const normalized: Shop['openingHours'] = [];
  for (const entry of openingHours) {
    if (!Array.isArray(entry) || entry.length < 2) return null;
    const open = normalizeTime(entry[0]);
    const close = normalizeTime(entry[1]);
    if (!open || !close) return null;
    normalized.push([open, close]);
  }

  return normalized;
};

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
  const { id } = params;

  // Validate id
  const shopId = parseInt(id);
  if (isNaN(shopId)) {
    error(404, m.invalid_shop_id());
  }

  const includeTimeInfo = url.searchParams.get('includeTimeInfo') !== 'false';

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

    const extraTimeInfo = (() => {
      if (!includeTimeInfo)
        return {} as Partial<{
          timezone: { name: string; offset: number };
          isOpen: boolean;
        }>;
      const openingHours = getShopOpeningHours(shop);
      const isOpen = now >= openingHours.openTolerated && now <= openingHours.closeTolerated;
      const timezoneName = getShopTimezone(shop.location);
      return {
        timezone: { name: timezoneName, offset: openingHours.offsetHours },
        isOpen
      };
    })();

    return json({
      shop: { ...toPlainObject(shop), ...extraTimeInfo }
    });
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error fetching shop:', err);
    error(500, m.failed_to_fetch_shop());
  }
};

export const PUT: RequestHandler = async ({ params, request, locals }) => {
  const { id } = params;

  const shopId = parseInt(id);
  if (isNaN(shopId)) {
    error(400, m.invalid_shop_id());
  }

  let body: Partial<Shop>;
  try {
    body = await request.json();
  } catch {
    error(400, 'Invalid request body');
  }

  const { name, comment, address, openingHours, location, games } = body;

  if (!name && !comment && !address && !openingHours && !location && !games) {
    error(400, 'No fields to update');
  }

  try {
    const db = mongo.db();
    const shopsCollection = db.collection<Shop>('shops');

    const existing = await shopsCollection.findOne({ id: shopId });
    if (!existing) {
      error(404, m.shop_not_found());
    }

    const updateFields: Partial<Shop> = { updatedAt: new Date() };
    if (name !== undefined) updateFields.name = name;
    if (comment !== undefined) updateFields.comment = comment;
    if (address !== undefined) updateFields.address = address;
    if (openingHours !== undefined) {
      const normalizedOpeningHours = normalizeOpeningHours(openingHours);
      if (!normalizedOpeningHours) {
        error(400, 'openingHours must be a non-empty array of [ {hour, minute}, {hour, minute} ]');
      }
      updateFields.openingHours = normalizedOpeningHours;
    }
    if (location !== undefined) updateFields.location = location;
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

    await shopsCollection.updateOne({ id: shopId }, { $set: updateFields });

    // Log changes to shop changelog (non-fatal)
    const changelogUser = {
      id: locals.session?.user?.id ?? null,
      name: locals.session?.user?.name,
      image: locals.session?.user?.image
    };
    try {
      await logShopFieldChanges(
        mongo,
        shopId,
        existing.name,
        existing,
        updateFields,
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
    return json({ shop: toPlainObject(updated!) });
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error updating shop:', err);
    error(500, 'Failed to update shop');
  }
};
