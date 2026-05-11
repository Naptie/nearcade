import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import { nanoid } from 'nanoid';
import { m } from '$lib/paraglide/messages';
import { logShopChange } from '$lib/utils/shops/changelog.server';
import { attachImagesToOwner } from '$lib/images/index.server';
import { withExistingImages } from '$lib/images/validation.server';
import {
  shopDeleteRequestCreateRequestSchema,
  shopDeleteRequestCreateResponseSchema,
  shopDeleteRequestSchema,
  shopIdParamSchema
} from '$lib/schemas/shops';
import { parseJsonOrError, parseParamsOrError } from '$lib/utils/validation.server';
import { toPlainObject } from '$lib/utils';

const shopDeleteRequestCreateRequestWithExistingImagesSchema = withExistingImages(
  shopDeleteRequestCreateRequestSchema
);

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const session = locals.session;
  if (!session?.user) {
    error(401, m.unauthorized());
  }

  const { id: shopId } = parseParamsOrError(shopIdParamSchema, params);
  const {
    reason,
    photoId,
    images: imageIds
  } = await parseJsonOrError(request, shopDeleteRequestCreateRequestWithExistingImagesSchema);

  const db = mongo.db();
  const shopsCollection = db.collection('shops');
  const shop = await shopsCollection.findOne({ id: shopId });

  if (!shop) {
    error(404, m.shop_not_found());
  }

  let photoUrl: string | null = null;

  if (photoId) {
    // Validate the photo belongs to this shop
    const photo = await db.collection('images').findOne({ id: photoId, shopId });
    if (!photo) {
      error(404, m.shop_photo_not_found());
    }
    photoUrl = photo.url;

    // Enforce one pending request per photo
    const existingPending = await db
      .collection('shop_delete_requests')
      .findOne({ shopId, photoId, status: 'pending' });
    if (existingPending) {
      error(409, m.shop_photo_delete_request_already_pending());
    }
  } else {
    // Enforce one pending request per shop (for shop delete requests without a photoId)
    const existingPending = await db.collection('shop_delete_requests').findOne({
      shopId,
      $or: [{ photoId: null }, { photoId: { $exists: false } }],
      status: 'pending'
    });

    if (existingPending) {
      error(409, m.shop_delete_request_already_pending());
    }
  }

  const user = session.user;

  const deleteRequest = shopDeleteRequestSchema.parse(
    toPlainObject({
      id: nanoid(),
      shopId,
      shopName: shop.name,
      reason,
      images: imageIds,
      requestedBy: user.id,
      requestedByName: user.name ?? null,
      status: 'pending',
      createdAt: new Date(),
      photoId: photoId ?? null,
      photoUrl: photoUrl ?? null
    })
  );

  const deleteRequestDocument: Omit<typeof deleteRequest, '_id'> = {
    ...deleteRequest
  };

  await db.collection('shop_delete_requests').insertOne(deleteRequestDocument);

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
    await db.collection('shop_delete_requests').deleteOne({ id: deleteRequest.id });
    throw attachmentError;
  }

  // Log to shop changelog (non-fatal)
  try {
    await logShopChange(mongo, {
      shopId,
      shopName: shop.name,
      action: photoId ? 'photo_delete_request_submitted' : 'delete_request_submitted',
      user: { id: user.id, name: user.name, image: user.image ?? null },
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

  const response = shopDeleteRequestCreateResponseSchema.parse({
    success: true,
    id: deleteRequest.id
  });

  return json(response, { status: 201 });
};