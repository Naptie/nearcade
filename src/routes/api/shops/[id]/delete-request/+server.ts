import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Shop, ShopDeleteRequest, ShopPhoto } from '$lib/types';
import mongo from '$lib/db/index.server';
import { nanoid } from 'nanoid';
import { m } from '$lib/paraglide/messages';
import { logShopChange } from '$lib/utils/shops/changelog.server';
import { attachImagesToOwner, normalizeImageIds } from '$lib/images/index.server';

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const session = locals.session;
  if (!session?.user) {
    error(401, m.unauthorized());
  }

  const { id } = params;

  const shopId = parseInt(id);
  if (isNaN(shopId)) {
    error(400, m.invalid_shop_id());
  }

  let body: { reason?: string; photoId?: string; images?: unknown };
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
  const imageIds = normalizeImageIds(body.images);

  const db = mongo.db();
  const shopsCollection = db.collection<Shop>('shops');
  const shop = await shopsCollection.findOne({ id: shopId });

  if (!shop) {
    error(404, m.shop_not_found());
  }

  let photoUrl: string | null = null;

  if (photoId) {
    // Validate the photo belongs to this shop
    const photo = await db.collection<ShopPhoto>('images').findOne({ id: photoId, shopId });
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
    // Enforce one pending request per shop (for shop delete requests without a photoId)
    const existingPending = await db.collection<ShopDeleteRequest>('shop_delete_requests').findOne({
      shopId,
      $or: [{ photoId: null }, { photoId: { $exists: false } }],
      status: 'pending'
    });

    if (existingPending) {
      error(409, m.shop_delete_request_already_pending());
    }
  }

  const user = session.user;

  const deleteRequest: ShopDeleteRequest = {
    id: nanoid(),
      shopId,
      shopName: shop.name,
      reason,
      images: imageIds,
      requestedBy: user.id,
      requestedByName: user.name ?? null,
    status: 'pending',
    createdAt: new Date(),
    photoId: photoId,
    photoUrl: photoUrl
  };

  await db.collection<ShopDeleteRequest>('shop_delete_requests').insertOne(deleteRequest);

  try {
    if (imageIds.length > 0) {
      await attachImagesToOwner(
        db,
        imageIds,
        { deleteRequestId: deleteRequest.id },
        { userId: user.id, userType: user.userType }
      );
    }
  } catch (attachmentError) {
    await db
      .collection<ShopDeleteRequest>('shop_delete_requests')
      .deleteOne({ id: deleteRequest.id });
    throw attachmentError;
  }

  // Log to shop changelog (non-fatal)
  try {
    await logShopChange(mongo, {
      shopId,
      shopName: shop.name,
      action: photoId ? 'photo_delete_request_submitted' : 'delete_request_submitted',
      user: { id: user.id, name: user.name ?? null, image: user.image ?? null },
      fieldInfo: {
        field: photoId ? 'photo' : 'delete_request',
        deleteRequestId: deleteRequest.id,
        photoId: photoId ?? null,
        photoUrl: photoUrl ?? null
      },
      metadata: { reason }
    });
  } catch (logErr) {
    console.error('Failed to log delete request changelog:', logErr);
  }

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
