/**
 * Opening a delete request for a whole shop or a single photo.
 *
 * The request is bookkeeping: it records who asked to remove what, and why.
 * It does not touch the shop or the photo itself.
 */

import { nanoid } from 'nanoid';
import mongo from '$lib/db/index.server';
import { attachImagesToOwner } from '$lib/images/index.server';
import { withExistingImages } from '$lib/images/validation.server';
import { m } from '$lib/paraglide/messages';
import { shopDeleteRequestCreateRequestSchema, shopDeleteRequestSchema } from '$lib/schemas/shops';
import type { Shop } from '$lib/types';
import { toPlainObject } from '$lib/utils';
import { requireBoundPhone } from '$lib/utils/index.server';
import { canModifyShop } from '$lib/utils/shops/authorization.server';
import { logShopChange } from '$lib/utils/shops/changelog.server';
import { auditUgc, blockedUgcMessage } from '$lib/ugc/audit.server';
import { submitUgc } from '$lib/ugc/entries.server';
import { apiError, parseOrApiErrorAsync } from '../../errors';
import { impl } from './delete-requests-shared';

export const shopsDeleteRequestsCreateImplementation = {
  /** `POST /api/shops/{id}/delete-request` */
  createDeleteRequest: impl.createDeleteRequest.handler(async ({ input, context }) => {
    // `guard: 'session'` on the contract already rejected an unauthenticated
    // request, so the session is present by construction.
    const session = context.session!;

    requireBoundPhone(session.user);

    const shopId = input.id;
    // The image assets have to exist — the contract only knows their ids.
    const {
      reason,
      photoId,
      images: imageIds
    } = await parseOrApiErrorAsync(withExistingImages(shopDeleteRequestCreateRequestSchema), input);

    const db = mongo.db();
    const shopsCollection = db.collection<Shop>('shops');
    const shop = await shopsCollection.findOne({ id: shopId });

    if (!shop) {
      apiError('NOT_FOUND', m.shop_not_found());
    }

    if (!canModifyShop(shop, session.user)) {
      apiError('FORBIDDEN', m.insufficient_permissions());
    }

    let photoUrl: string | null = null;

    if (photoId) {
      // Validate the photo belongs to this shop
      const photo = await db.collection('images').findOne({ id: photoId, shopId });
      if (!photo) {
        apiError('NOT_FOUND', m.shop_photo_not_found());
      }
      photoUrl = photo.url;

      // Enforce one pending request per photo
      const existingPending = await db
        .collection('shop_delete_requests')
        .findOne({ shopId, photoId, status: 'pending' });
      if (existingPending) {
        apiError('CONFLICT', m.shop_photo_delete_request_already_pending());
      }
    } else {
      // Enforce one pending request per shop (for shop delete requests without a photoId)
      const existingPending = await db.collection('shop_delete_requests').findOne({
        shopId,
        $or: [{ photoId: null }, { photoId: { $exists: false } }],
        status: 'pending'
      });

      if (existingPending) {
        apiError('CONFLICT', m.shop_delete_request_already_pending());
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

    // Tier-0 moderation gate: reject the request before persisting it.
    const blocked = await auditUgc('delete_request', deleteRequest.id, reason);
    if (blocked) {
      apiError('BAD_REQUEST', blockedUgcMessage(blocked));
    }

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

    // Register entry + queue background pre-translation for the reason text.
    submitUgc('delete_request', deleteRequest.id, user, { reason });

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

    return {
      success: true,
      id: deleteRequest.id
    };
  })
};
