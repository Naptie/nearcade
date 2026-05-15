import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { z } from 'zod';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { logShopChange } from '$lib/utils/shops/changelog.server';
import { deleteFile } from '$lib/oss/index';
import { shopPhotoIdParamSchema, shopPhotoSchema } from '$lib/schemas/shops';
import { parseParamsOrError } from '$lib/utils/validation.server';
import { successResponseSchema } from '$lib/schemas/common';

type ShopPhotoEntry = z.infer<typeof shopPhotoSchema>;

/**
 * DELETE /api/shops/:id/photos/:photoId
 * Admins and the photo uploader can delete directly.
 * Other authenticated users should use the delete-request flow (POST /api/shops/:id/delete-request with photoId).
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
  const session = locals.session;
  if (!session?.user) {
    error(401, m.insufficient_permissions());
  }

  const { id: shopId, photoId } = parseParamsOrError(shopPhotoIdParamSchema, params);

  const db = mongo.db();
  const photosCollection = db.collection<ShopPhotoEntry>('images');
  const [shop, photo] = await Promise.all([
    db.collection('shops').findOne({ id: shopId }),
    photosCollection.findOne({ id: photoId, shopId })
  ]);

  if (!photo) {
    error(404, m.shop_photo_not_found());
  }
  if (!shop) {
    error(404, m.shop_not_found());
  }

  const isAdmin = session.user.userType === 'site_admin';
  const isUploader = photo.uploadedBy === session.user.id;

  if (!isAdmin && !isUploader) {
    error(403, m.insufficient_permissions());
  }

  await deleteFile(photo);
  await db.collection('images').deleteOne({ id: photoId });

  // Log to shop changelog (non-fatal)
  try {
    await logShopChange(mongo, {
      shopId,
      shopName: shop.name,
      action: 'photo_deleted',
      user: { id: session.user.id, name: session.user.name, image: session.user.image },
      fieldInfo: { field: 'photo', photoId, photoUrl: photo.url },
      metadata: { uploadedBy: photo.uploadedBy }
    });
  } catch (logErr) {
    console.error('Failed to log photo deletion changelog:', logErr);
  }

  return json(successResponseSchema.parse({ success: true }));
};
