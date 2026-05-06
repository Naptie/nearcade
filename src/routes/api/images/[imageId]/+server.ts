import { json, error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { deleteImagesByIds, getImagesByIds } from '$lib/images/index.server';

export const DELETE: RequestHandler = async ({ params, locals }) => {
  try {
    const session = locals.session;
    if (!session?.user?.id) {
      error(401, m.unauthorized());
    }

    const { imageId } = params;
    if (!imageId) {
      error(400, 'Invalid image id');
    }

    const db = mongo.db();
    const images = await getImagesByIds(db, [imageId]);
    if (images.length === 0) {
      error(404, 'Image not found');
    }

    await deleteImagesByIds(db, [imageId], {
      userId: session.user.id,
      userType: session.user.userType
    });

    return json({ success: true });
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }

    console.error('Error deleting image:', err);
    error(500, m.internal_server_error());
  }
};
