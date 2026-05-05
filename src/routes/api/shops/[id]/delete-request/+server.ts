import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Shop, ShopDeleteRequest, ShopPhoto } from '$lib/types';
import mongo from '$lib/db/index.server';
import { nanoid } from 'nanoid';
import { m } from '$lib/paraglide/messages';

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const { id } = params;

  const shopId = parseInt(id);
  if (isNaN(shopId)) {
    error(400, m.invalid_shop_id());
  }

  let body: { reason?: string; photoId?: string };
  try {
    body = await request.json();
  } catch {
    error(400, 'Invalid request body');
  }

  const reason = (body.reason || '').trim();
  if (!reason) {
    error(400, 'Reason is required');
  }

  const photoId = body.photoId?.trim() || null;

  const db = mongo.db();
  const shopsCollection = db.collection<Shop>('shops');
  const shop = await shopsCollection.findOne({ id: shopId });

  if (!shop) {
    error(404, m.shop_not_found());
  }

  let photoUrl: string | null = null;

  if (photoId) {
    // Validate the photo belongs to this shop
    const photo = await db.collection<ShopPhoto>('shop_photos').findOne({ id: photoId, shopId });
    if (!photo) {
      error(404, m.shop_photo_not_found());
    }
    photoUrl = photo.url;

    // Enforce one pending request per photo
    const existingPending = await db
      .collection<ShopDeleteRequest>('shop_delete_requests')
      .findOne({ shopId, photoId, status: 'pending' });
    if (existingPending) {
      error(409, m.shop_photo_delete_request_already_pending());
    }
  } else {
    // Enforce one pending request per shop (for shop delete requests)
    const existingPending = await db
      .collection<ShopDeleteRequest>('shop_delete_requests')
      .findOne({ shopId, photoId: { $in: [null, undefined] }, status: 'pending' });

    if (existingPending) {
      error(409, m.shop_delete_request_already_pending());
    }
  }

  const session = locals.session;
  const user = session?.user ?? null;

  const deleteRequest: ShopDeleteRequest = {
    id: nanoid(),
    shopId,
    shopName: shop.name,
    reason,
    requestedBy: user?.id ?? null,
    requestedByName: user?.name ?? null,
    status: 'pending',
    createdAt: new Date(),
    photoId: photoId ?? undefined,
    photoUrl: photoUrl ?? undefined
  };

  await db.collection<ShopDeleteRequest>('shop_delete_requests').insertOne(deleteRequest);

  return json({ success: true, id: deleteRequest.id }, { status: 201 });
};

export const GET: RequestHandler = async ({ params, locals }) => {
  const session = locals.session;
  if (!session?.user || session.user.userType !== 'site_admin') {
    error(403, m.insufficient_permissions());
  }

  const { id } = params;

  const shopId = parseInt(id);
  if (isNaN(shopId)) {
    error(400, m.invalid_shop_id());
  }

  const db = mongo.db();
  const requests = await db
    .collection('shop_delete_requests')
    .find({ shopId })
    .sort({ createdAt: -1 })
    .toArray();

  return json({ requests });
};
