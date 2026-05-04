import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Shop, ShopDeleteRequest } from '$lib/types';
import { ShopSource } from '$lib/constants';
import mongo from '$lib/db/index.server';
import { nanoid } from 'nanoid';
import { m } from '$lib/paraglide/messages';

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const { source: sourceRaw, id } = params;
  const source = sourceRaw.toLowerCase().trim() as ShopSource;

  if (!Object.values(ShopSource).includes(source)) {
    error(400, m.invalid_shop_source());
  }

  const shopId = parseInt(id);
  if (isNaN(shopId)) {
    error(400, m.invalid_shop_id());
  }

  let body: { reason?: string };
  try {
    body = await request.json();
  } catch {
    error(400, 'Invalid request body');
  }

  const reason = (body.reason || '').trim();
  if (!reason) {
    error(400, 'Reason is required');
  }

  const db = mongo.db();
  const shopsCollection = db.collection<Shop>('shops');
  const shop = await shopsCollection.findOne({ source, id: shopId });

  if (!shop) {
    error(404, m.shop_not_found());
  }

  const session = locals.session;
  const user = session?.user ?? null;

  const deleteRequest: ShopDeleteRequest = {
    id: nanoid(),
    shopSource: source,
    shopId,
    shopName: shop.name,
    reason,
    requestedBy: user?.id ?? null,
    requestedByName: user?.name ?? null,
    status: 'pending',
    createdAt: new Date()
  };

  await db.collection('shop_delete_requests').insertOne(deleteRequest);

  return json({ success: true, id: deleteRequest.id }, { status: 201 });
};

export const GET: RequestHandler = async ({ params, locals }) => {
  const session = locals.session;
  if (!session?.user || session.user.userType !== 'site_admin') {
    error(403, m.insufficient_permissions());
  }

  const { source: sourceRaw, id } = params;
  const source = sourceRaw.toLowerCase().trim() as ShopSource;

  if (!Object.values(ShopSource).includes(source)) {
    error(400, m.invalid_shop_source());
  }

  const shopId = parseInt(id);
  if (isNaN(shopId)) {
    error(400, m.invalid_shop_id());
  }

  const db = mongo.db();
  const requests = await db
    .collection('shop_delete_requests')
    .find({ shopSource: source, shopId })
    .sort({ createdAt: -1 })
    .toArray();

  return json({ requests });
};
