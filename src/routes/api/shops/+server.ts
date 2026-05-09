import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import type { Shop } from '$lib/types';
import { getShopOpeningHours, getShopTimezone, toPlainArray, toPlainObject } from '$lib/utils';
import { PAGINATION } from '$lib/constants';
import { nanoid } from 'nanoid';
import { createShopBodySchema, shopsListQuerySchema } from '$lib/schemas/shops';
import { parseJsonOrError, parseQueryOrError } from '$lib/utils/validation.server';

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

const findLowestUnoccupiedShopId = (ids: number[]) => {
  const occupied = new Set(ids.filter((id) => Number.isInteger(id) && id > 0));
  let candidate = 1;
  while (occupied.has(candidate)) {
    candidate += 1;
  }
  return candidate;
};

const normalizeGamesForShop = (shopId: number, games: unknown): Shop['games'] | null => {
  if (!Array.isArray(games)) return null;

  const parsed = games.map((item, originalIndex) => {
    if (!item || typeof item !== 'object') return null;

    const candidate = item as {
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
      originalIndex,
      game: {
        titleId: candidate.titleId,
        name: candidate.name,
        version: candidate.version,
        comment: typeof candidate.comment === 'string' ? candidate.comment : '',
        quantity:
          typeof candidate.quantity === 'number' && Number.isFinite(candidate.quantity)
            ? Math.max(0, Math.floor(candidate.quantity))
            : 1,
        cost: typeof candidate.cost === 'string' ? candidate.cost : ''
      }
    };
  });

  if (parsed.some((item) => item === null)) return null;

  const validGames = parsed as Array<{
    originalIndex: number;
    game: Omit<Shop['games'][number], 'gameId'>;
  }>;

  const sorted = [...validGames].sort((left, right) => {
    return (
      left.game.titleId - right.game.titleId ||
      left.game.name.localeCompare(right.game.name) ||
      left.game.version.localeCompare(right.game.version) ||
      left.originalIndex - right.originalIndex
    );
  });

  const idByOriginalIndex = new Map<number, number>();
  sorted.forEach((entry, index) => {
    idByOriginalIndex.set(entry.originalIndex, shopId * 1000 + index);
  });

  return validGames.map((entry) => ({
    ...entry.game,
    gameId: idByOriginalIndex.get(entry.originalIndex)!
  }));
};

export const GET: RequestHandler = async ({ url }) => {
  const {
    q: query,
    page,
    limit: parsedLimit,
    includeTimeInfo
  } = parseQueryOrError(shopsListQuerySchema, url);
  const limit = parsedLimit || PAGINATION.PAGE_SIZE;
  const skip = (page - 1) * limit;

  try {
    const db = mongo.db();
    const shopsCollection = db.collection<Shop>('shops');

    let shops: Shop[];
    let totalCount: number;
    if (query.trim().length === 0) {
      // Fetch all shops with pagination
      totalCount = await shopsCollection.countDocuments();
      shops = (await shopsCollection
        .find({})
        .sort({ name: 1 })
        .collation({ locale: 'zh@collation=gb2312han' })
        .skip(skip)
        .limit(limit)
        .toArray()) as unknown as Shop[];
    } else {
      // Search shops
      let searchResults: Shop[];

      try {
        // Try Atlas Search first
        searchResults = (await shopsCollection
          .aggregate([
            {
              $search: {
                index: 'default',
                compound: {
                  should: [
                    {
                      text: {
                        query: query,
                        path: 'name',
                        score: { boost: { value: 2 } }
                      }
                    },
                    {
                      text: {
                        query: query,
                        path: 'address.general'
                      }
                    },
                    {
                      text: {
                        query: query,
                        path: 'address.detailed'
                      }
                    }
                  ]
                }
              }
            },
            { $sort: { score: { $meta: 'searchScore' }, name: 1 } },
            { $skip: skip },
            { $limit: limit }
          ])
          .toArray()) as unknown as Shop[];
      } catch {
        // Fallback to regex search
        const searchQuery = {
          $or: [
            { name: { $regex: query, $options: 'i' } },
            { 'address.general': { $elemMatch: { $regex: query, $options: 'i' } } },
            { 'address.detailed': { $regex: query, $options: 'i' } }
          ]
        };

        totalCount = await shopsCollection.countDocuments(searchQuery);
        searchResults = (await shopsCollection
          .find(searchQuery)
          .sort({ name: 1 })
          .collation({ locale: 'zh@collation=gb2312han' })
          .skip(skip)
          .limit(limit)
          .toArray()) as unknown as Shop[];
      }

      shops = searchResults;
      if (!totalCount!) {
        totalCount = shops.length + (shops.length === limit ? 1 : 0);
      }
    }

    const now = new Date();

    return json({
      shops: toPlainArray(
        shops.map((shop) => {
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

          return {
            ...shop,
            ...extraTimeInfo
          };
        })
      ),
      totalCount,
      currentPage: page,
      hasNextPage: skip + shops.length < totalCount,
      hasPrevPage: page > 1
    });
  } catch (error) {
    console.error('Error searching shops:', error);
    return json({ shops: [] }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await parseJsonOrError(request, createShopBodySchema);
  const { name, location, openingHours, address, comment, games } = body;

  const normalizedOpeningHours = normalizeOpeningHours(openingHours);
  if (!normalizedOpeningHours) {
    return json(
      { error: 'openingHours must be a non-empty array of [ {hour, minute}, {hour, minute} ]' },
      { status: 400 }
    );
  }

  try {
    const db = mongo.db();
    const shopsCollection = db.collection<Shop>('shops');

    const existingIds = await shopsCollection.find({}, { projection: { id: 1 } }).toArray();
    const newId = findLowestUnoccupiedShopId(existingIds.map((shop) => shop.id));

    const normalizedGames = games === undefined ? [] : normalizeGamesForShop(newId, games);
    if (games !== undefined && !normalizedGames) {
      return json(
        { error: 'games must be an array of game objects with titleId, name, and version' },
        { status: 400 }
      );
    }

    const now = new Date();
    const newShop: Shop = {
      _id: nanoid(),
      id: newId,
      name: name.trim(),
      comment: comment ?? '',
      address: address ?? { general: [], detailed: '' },
      openingHours: normalizedOpeningHours,
      location,
      games: normalizedGames ?? [],
      createdAt: now,
      updatedAt: now
    };

    await shopsCollection.insertOne(newShop as Parameters<typeof shopsCollection.insertOne>[0]);

    return json({ shop: toPlainObject(newShop) }, { status: 201 });
  } catch (err) {
    console.error('Error creating shop:', err);
    return json({ error: 'Failed to create shop' }, { status: 500 });
  }
};
