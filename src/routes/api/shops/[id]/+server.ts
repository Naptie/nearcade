import { json, error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { Shop } from '$lib/types';
import { getShopOpeningHours, getShopTimezone, toPlainObject } from '$lib/utils';
import mongo from '$lib/db/index.server';
import type { RequestHandler } from './$types';
import { m } from '$lib/paraglide/messages';

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

export const PUT: RequestHandler = async ({ params, request }) => {
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
    if (games !== undefined) updateFields.games = games;

    await shopsCollection.updateOne({ id: shopId }, { $set: updateFields });

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
