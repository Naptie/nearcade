import { json, error, isHttpError, isRedirect, redirect } from '@sveltejs/kit';
import type { Shop } from '$lib/types';
import { getShopOpeningHours, getShopTimezone, toPlainObject } from '$lib/utils';
import mongo from '$lib/db/index.server';
import { ShopSource, SHOP_ID_OFFSET_BEMANICN, SHOP_ID_OFFSET_ZIV } from '$lib/constants';
import type { RequestHandler } from './$types';
import { m } from '$lib/paraglide/messages';
import { base } from '$app/paths';

export const GET: RequestHandler = async ({ params, url }) => {
  const { source: sourceRaw, id } = params;
  const source = sourceRaw.toLowerCase().trim();

  // Validate source
  if (!Object.values(ShopSource).includes(source as ShopSource)) {
    error(404, m.invalid_shop_source());
  }

  // Validate id
  const shopId = parseInt(id);
  if (isNaN(shopId)) {
    error(404, m.invalid_shop_id());
  }

  // Redirect legacy sources to nearcade
  if (source === ShopSource.BEMANICN) {
    redirect(301, `${base}/api/shops/${ShopSource.NEARCADE}/${shopId + SHOP_ID_OFFSET_BEMANICN}`);
  }
  if (source === ShopSource.ZIV) {
    redirect(301, `${base}/api/shops/${ShopSource.NEARCADE}/${shopId + SHOP_ID_OFFSET_ZIV}`);
  }

  const includeTimeInfo = url.searchParams.get('includeTimeInfo') !== 'false';

  try {
    const db = mongo.db();
    const shopsCollection = db.collection<Shop>('shops');

    // Find the shop by source and id
    const shop = await shopsCollection.findOne({
      source: source as ShopSource,
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
  const { source: sourceRaw, id } = params;
  const source = sourceRaw.toLowerCase().trim();

  if (source !== ShopSource.NEARCADE) {
    error(400, 'Only nearcade shops can be updated');
  }

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

    const existing = await shopsCollection.findOne({ source: ShopSource.NEARCADE, id: shopId });
    if (!existing) {
      error(404, m.shop_not_found());
    }

    const updateFields: Partial<Shop> = { updatedAt: new Date() };
    if (name !== undefined) updateFields.name = name;
    if (comment !== undefined) updateFields.comment = comment;
    if (address !== undefined) updateFields.address = address;
    if (openingHours !== undefined) updateFields.openingHours = openingHours;
    if (location !== undefined) updateFields.location = location;
    if (games !== undefined) updateFields.games = games;

    await shopsCollection.updateOne(
      { source: ShopSource.NEARCADE, id: shopId },
      { $set: updateFields }
    );

    const updated = await shopsCollection.findOne({ source: ShopSource.NEARCADE, id: shopId });
    return json({ shop: toPlainObject(updated!) });
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error updating shop:', err);
    error(500, 'Failed to update shop');
  }
};
