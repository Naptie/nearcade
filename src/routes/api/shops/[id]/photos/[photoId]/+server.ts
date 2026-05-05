import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { ShopPhoto } from '$lib/types';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';

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

  const { id, photoId } = params;
  const shopId = parseInt(id);
  if (isNaN(shopId)) {
    error(400, m.invalid_shop_id());
  }

  const db = mongo.db();
  const photo = await db.collection<ShopPhoto>('shop_photos').findOne({ id: photoId, shopId });
  if (!photo) {
    error(404, m.shop_photo_not_found());
  }

  const isAdmin = session.user.userType === 'site_admin';
  const isUploader = photo.uploadedBy === session.user.id;

  if (!isAdmin && !isUploader) {
    error(403, m.insufficient_permissions());
  }

  await db.collection('shop_photos').deleteOne({ id: photoId });

  return json({ success: true });
};
