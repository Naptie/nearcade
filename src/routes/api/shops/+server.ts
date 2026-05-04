import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import type { Shop } from '$lib/types';
import { getShopOpeningHours, getShopTimezone, toPlainArray, toPlainObject } from '$lib/utils';
import { PAGINATION } from '$lib/constants';
import { nanoid } from 'nanoid';

const NEARCADE_ID_START = 30000;

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

export const GET: RequestHandler = async ({ url }) => {
  const query = url.searchParams.get('q') || '';
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = parseInt(url.searchParams.get('limit') || '0') || PAGINATION.PAGE_SIZE;
  const skip = (page - 1) * limit;

  const includeTimeInfo = url.searchParams.get('includeTimeInfo') !== 'false';

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
  let body: Partial<Shop>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { name, location, openingHours, address, comment, games } = body;

  if (!name || !location || !openingHours) {
    return json({ error: 'name, location, and openingHours are required' }, { status: 400 });
  }

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

    const lastNearcadeShop = await shopsCollection
      .find({ id: { $gte: NEARCADE_ID_START } })
      .sort({ id: -1 })
      .limit(1)
      .toArray();

    const newId =
      lastNearcadeShop.length > 0
        ? Math.max(lastNearcadeShop[0].id + 1, NEARCADE_ID_START)
        : NEARCADE_ID_START;

    const now = new Date();
    const newShop: Shop = {
      _id: nanoid(),
      id: newId,
      name: name.trim(),
      comment: comment ?? '',
      address: address ?? { general: [], detailed: '' },
      openingHours: normalizedOpeningHours,
      location,
      games: games ?? [],
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
