import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import { syncShopDocument } from '$lib/db/meili.server';
import { reassignShopTransitInBackground } from '$lib/openmetro/assign.server';
import type { Shop } from '$lib/types';
import { toPlainObject } from '$lib/utils';
import { PAGINATION } from '$lib/constants';
import { nanoid } from 'nanoid';
import {
  createShopRequestSchema,
  shopResponseSchema,
  shopsListQuerySchema,
  shopsListResponseSchema
} from '$lib/schemas/shops';
import { requireBoundPhone } from '$lib/utils/index.server';
import { parseJsonOrError, parseQueryOrError } from '$lib/utils/validation.server';
import { m } from '$lib/paraglide/messages';
import { readShopPageQuery } from '$lib/utils/shops/filter';
import { queryShops } from '$lib/endpoints/shop-search.server';
import { logShopChange } from '$lib/utils/shops/changelog.server';
import { getNextShopId } from '$lib/utils/shops/id.server';
import { auditUgc, blockedUgcMessage } from '$lib/ugc/audit.server';
import { submitUgc } from '$lib/ugc/entries.server';
import { toShopApi, toShopApiList } from '$lib/utils/shops/api.server';
import { computeShopDerivedFields } from '$lib/utils/shops/derived';
import { IncompleteShopRegionError, resolveShopAddress } from '$lib/utils/region.server';

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

export const GET: RequestHandler = async ({ url, locals }) => {
  const { limit: parsedLimit, includeTimeInfo } = parseQueryOrError(shopsListQuerySchema, url);
  const limit = parsedLimit || PAGINATION.PAGE_SIZE;
  // q / sort / f / legacy regionId go through the shared page-query contract
  // so the REST endpoint matches the /shops page and the globe exactly.
  const { q, sort, page, filter } = readShopPageQuery(url.searchParams);

  try {
    const result = await queryShops({
      filter,
      q,
      sort,
      page,
      limit,
      session: locals.session
    });

    const now = new Date();

    const response = shopsListResponseSchema.parse(
      toPlainObject({
        shops: await toShopApiList(result.shops, { includeTimeInfo, now }),
        totalCount: result.total,
        currentPage: page,
        hasNextPage: page * limit < result.total,
        hasPrevPage: page > 1
      })
    );

    return json(response);
  } catch (error) {
    console.error('Error searching shops:', error);
    return json({ error: 'Failed to search shops' }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ request, locals }) => {
  const session = locals.session;
  if (!session?.user) {
    error(401, m.unauthorized());
  }

  requireBoundPhone(session.user);

  const body = await parseJsonOrError(request, createShopRequestSchema);
  const { name, location, openingHours, address, comment, games, isClosed, closedReason } = body;
  // `openingHours` is already canonical (schema transform lifts overnight
  // closes past midnight) and validated non-empty.

  try {
    const db = mongo.db();
    const shopsCollection = db.collection<Shop>('shops');

    const newId = await getNextShopId(db);

    const normalizedGames = games === undefined ? [] : normalizeGamesForShop(newId, games);
    if (games !== undefined && !normalizedGames) {
      return json(
        { error: 'games must be an array of game objects with titleId, name, and version' },
        { status: 400 }
      );
    }

    const resolvedAddress = await resolveShopAddress({
      general: address?.general ?? [],
      detailed: address?.detailed ?? '',
      region: address?.region as string[] | undefined,
      coordinates: location?.coordinates ?? null
    });

    if (resolvedAddress.region.length === 0) {
      return json(
        {
          error:
            'address.region is required; provide a leaf region ID or a complete address.general'
        },
        { status: 400 }
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

    const shopUgcTexts: Record<string, string> = {
      shop_name: newShop.name,
      shop_description: newShop.comment ?? '',
      shop_address: newShop.address?.detailed ?? '',
      ...Object.fromEntries(
        (newShop.games ?? []).flatMap((game) => [
          [`game_name:${game.gameId}`, game.name],
          [`game_version:${game.gameId}`, game.version ?? ''],
          [`game_cost:${game.gameId}`, game.cost ?? ''],
          [`game_description:${game.gameId}`, game.comment ?? '']
        ])
      )
    };

    // Tier-0 moderation gate: reject before anything is persisted.
    const blocked = await auditUgc('shop', newShop.id, shopUgcTexts);
    if (blocked) {
      error(400, blockedUgcMessage(blocked));
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
    submitUgc('shop', newShop.id, session.user, shopUgcTexts);

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

    const response = shopResponseSchema.parse(
      toPlainObject({ shop: await toShopApi(newShop, { now }) })
    );

    return json(response, { status: 201 });
  } catch (err) {
    if (err instanceof IncompleteShopRegionError) {
      return json({ error: m.shop_region_incomplete() }, { status: 400 });
    }
    console.error('Error creating shop:', err);
    return json({ error: 'Failed to create shop' }, { status: 500 });
  }
};
