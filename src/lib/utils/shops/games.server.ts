import type { Shop } from '$lib/types';

/**
 * The game-normalisation helpers decide how an incoming game list maps onto
 * the stored `gameId` values. A shop reserves exactly 1000 id slots, so a
 * new entry is allocated from `shopId * 1000` upward and an update fails
 * once that range is exhausted.
 *
 * The ids have to survive an update: a photo, a changelog entry and an
 * attendance record all point at a game by its id, so a game that is still in
 * the list keeps the id it had.
 */

/** The number of game-id slots a shop reserves for its games. */
const GAME_ID_SLOTS_PER_SHOP = 1000;

/**
 * A game as it arrives from a client, before its `gameId` is settled.
 *
 * `gameId` is only meaningful in an update, where the client may send the id
 * the game already has; a creation never trusts it.
 */
type ParsedGameInput = {
  gameId?: number;
} & Omit<Shop['games'][number], 'gameId'>;

/**
 * How the ids of a shop's games are settled.
 *
 * The two callers mean different things by "the same list", and the difference
 * must not be averaged away: a shop that does not exist yet has no ids to
 * reuse, so its games are numbered in the order they sort into, while an
 * update keeps the ids the shop already handed out and only takes the free
 * slots for the games that are new.
 */
export type ShopGameAllocation =
  /** A shop that does not exist yet: every game gets a fresh id. */
  | { mode: 'create' }
  /** An existing shop: the games it still holds keep the ids they have. */
  | { mode: 'update'; existingGames: Shop['games'] };

/**
 * Parse the incoming game list.
 *
 * A list that holds anything but game objects is rejected as a whole rather
 * than partly accepted: the game list of a shop is either the list that was
 * asked for or nothing at all.
 */
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

/** The key that identifies a game exactly — every field has to match. */
const gameKey = (game: ParsedGameInput) =>
  `${game.titleId}\u0000${game.name}\u0000${game.version}\u0000${game.comment}\u0000${game.quantity}\u0000${game.cost}`;

/** The key that identifies a game by its title, ignoring the fields a client may restate. */
const gameIdentityKey = (game: ParsedGameInput) =>
  `${game.titleId}\u0000${game.name}\u0000${game.version}`;

/** The order the games are listed in, so the ids a shop hands out are stable. */
const compareGameInput = (left: ParsedGameInput, right: ParsedGameInput) => {
  return (
    left.titleId - right.titleId ||
    left.name.localeCompare(right.name) ||
    left.version.localeCompare(right.version)
  );
};

/**
 * Hand out the free ids of a shop's reserved range.
 *
 * The ids above the ones already taken are used first, and the range is
 * scanned from its start when that is not enough. A shop that has run out of
 * slots gets fewer ids than it asked for, which the caller turns into a
 * rejected update.
 */
const allocateNewGameIds = (
  shopId: number,
  occupiedIds: Set<number>,
  requestedCount: number
): number[] => {
  const start = shopId * GAME_ID_SLOTS_PER_SHOP;
  const end = start + GAME_ID_SLOTS_PER_SHOP - 1;
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

/**
 * Number the games of a shop that does not exist yet.
 *
 * The ids follow the order the games sort into, so the same list always gets
 * the same ids no matter in which order the client sent it.
 */
const assignNewGameIds = (shopId: number, games: ParsedGameInput[]): Shop['games'] => {
  const sorted = games
    .map((game, originalIndex) => ({ game, originalIndex }))
    .sort((left, right) => {
      return compareGameInput(left.game, right.game) || left.originalIndex - right.originalIndex;
    });

  const idByOriginalIndex = new Map<number, number>();
  sorted.forEach((entry, index) => {
    idByOriginalIndex.set(entry.originalIndex, shopId * GAME_ID_SLOTS_PER_SHOP + index);
  });

  return games.map((game, originalIndex) => ({
    titleId: game.titleId,
    name: game.name,
    version: game.version,
    comment: game.comment,
    quantity: game.quantity,
    cost: game.cost,
    gameId: idByOriginalIndex.get(originalIndex)!
  }));
};

/**
 * Settle the ids of the games of a shop that already exists.
 *
 * A game that is still in the list keeps the id it had, so the photos, the
 * changelog entries and the attendance records that point at it stay valid.
 * The games that are new take the free slots of the shop's reserved range.
 */
const reconcileGameIds = (
  shopId: number,
  incomingGames: ParsedGameInput[],
  existingGames: Shop['games']
): Shop['games'] | null => {
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
  const resolved = new Array<Shop['games'][number]>(incomingGames.length);
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

  for (const [index, game] of incomingGames.entries()) {
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

/**
 * Settle the ids of an incoming game list.
 *
 * The allocation is a parameter because the two callers mean different things
 * by "the same list": a creation has nothing to reuse, an update has to
 * preserve the ids the shop already handed out.
 *
 * `null` means the list is not a list of games, or that the shop has no
 * slots left for the games that are new.
 */
export const normalizeGamesForShop = (
  shopId: number,
  games: unknown,
  allocation: ShopGameAllocation
): Shop['games'] | null => {
  const parsed = parseGamesInput(games);
  if (!parsed) return null;

  if (allocation.mode === 'create') {
    return assignNewGameIds(shopId, parsed);
  }

  return reconcileGameIds(shopId, parsed, allocation.existingGames);
};
