import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { z } from 'zod';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { notify } from '$lib/notifications/index.server';
import { logShopChange } from '$lib/utils/shops/changelog.server';
import { deleteFile } from '$lib/oss/index';
import { deleteImagesForOwner, hydrateEntitiesWithImages } from '$lib/images/index.server';
import {
  shopDeleteRequestDetailResponseSchema,
  shopDeleteRequestIdParamSchema,
  shopDeleteRequestReviewRequestSchema,
  shopDeleteRequestReviewResponseSchema,
  shopDeleteRequestSchema,
  shopPhotoSchema
} from '$lib/schemas/shops';
import { parseJsonOrError, parseParamsOrError } from '$lib/utils/validation.server';
import { successResponseSchema } from '$lib/schemas/common';
import { toPlainObject } from '$lib/utils';
import { getShopDeleteRequestVoteSummary } from '$lib/utils/shops/delete-request.server';

type ShopDeleteRequestEntry = z.infer<typeof shopDeleteRequestSchema>;
type ShopPhotoEntry = z.infer<typeof shopPhotoSchema>;

export const GET: RequestHandler = async ({ params, locals }) => {
  const { id } = parseParamsOrError(shopDeleteRequestIdParamSchema, params);
  const db = mongo.db();
  const deleteRequestsCollection = db.collection<ShopDeleteRequestEntry>('shop_delete_requests');

  const deleteRequest = await deleteRequestsCollection.findOne({ id });
  if (!deleteRequest) {
    error(404, m.shop_delete_request_not_found());
  }

  const [hydratedDeleteRequest] = await hydrateEntitiesWithImages(db, [deleteRequest]);
  const voteSummary = await getShopDeleteRequestVoteSummary(
    db,
    hydratedDeleteRequest.id,
    locals.session?.user?.id
  );

  const response = shopDeleteRequestDetailResponseSchema.parse(
    toPlainObject({
      deleteRequest: hydratedDeleteRequest,
      voteSummary
    })
  );

  return json(response);
};

/**
 * DELETE /api/shops/delete-requests/:id
 * - Submitter can retract their own pending request
 * - Admin can delete any request regardless of status
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
  const session = locals.session;
  if (!session?.user) {
    error(401, m.insufficient_permissions());
  }

  const { id } = parseParamsOrError(shopDeleteRequestIdParamSchema, params);
  const db = mongo.db();
  const deleteRequestsCollection = db.collection<ShopDeleteRequestEntry>('shop_delete_requests');

  const deleteRequest = await deleteRequestsCollection.findOne({ id });

  if (!deleteRequest) {
    error(404, m.shop_delete_request_not_found());
  }

  const isAdmin = session.user.userType === 'site_admin';
  const isRequester = deleteRequest.requestedBy === session.user.id;

  if (!isAdmin && !isRequester) {
    error(403, m.insufficient_permissions());
  }

  // Non-admins can only retract pending requests
  if (!isAdmin && deleteRequest.status !== 'pending') {
    error(400, 'Can only retract pending requests');
  }

  await deleteImagesForOwner(
    db,
    { deleteRequestId: id },
    {
      userId: session.user.id,
      userType: session.user.userType,
      skipPermissionCheck: true
    }
  );

  await db.collection('shop_delete_requests').deleteOne({ id });

  return json(successResponseSchema.parse({ success: true }));
};

/**
 * PATCH /api/shops/delete-requests/:id
 * Body: { action: 'approve' | 'reject', reviewNote?: string }
 * Admin only: approve or reject a pending request
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  const session = locals.session;
  if (!session?.user || session.user.userType !== 'site_admin') {
    error(403, m.insufficient_permissions());
  }

  const { id } = parseParamsOrError(shopDeleteRequestIdParamSchema, params);
  const { action, reviewNote } = await parseJsonOrError(
    request,
    shopDeleteRequestReviewRequestSchema
  );

  const db = mongo.db();
  const deleteRequestsCollection = db.collection<ShopDeleteRequestEntry>('shop_delete_requests');
  const photosCollection = db.collection<ShopPhotoEntry>('images');

  const deleteRequest = await deleteRequestsCollection.findOne({ id });

  if (!deleteRequest) {
    error(404, m.shop_delete_request_not_found());
  }

  if (deleteRequest.status !== 'pending') {
    error(409, 'Request has already been processed');
  }

  const now = new Date();
  const newStatus = action === 'approve' ? 'approved' : 'rejected';

  if (action === 'approve') {
    if (deleteRequest.photoId) {
      const photo = await photosCollection.findOne({
        id: deleteRequest.photoId,
        shopId: deleteRequest.shopId
      });
      if (photo) {
        deleteRequest.photoUrl = photo.url;
        await deleteFile(photo);
      }
      // Delete the specific photo
      await db.collection('images').deleteOne({ id: deleteRequest.photoId });
    } else {
      // Delete the shop
      await db.collection('shops').deleteOne({ id: deleteRequest.shopId });
    }
  }

  // Update the request status
  await db.collection('shop_delete_requests').updateOne(
    { id },
    {
      $set: {
        status: newStatus,
        reviewedAt: now,
        reviewedBy: session.user.id,
        reviewNote: reviewNote?.trim() || null
      }
    }
  );

  // Send notification to the requester
  if (deleteRequest.requestedBy) {
    try {
      const notification: Parameters<typeof notify>[0] = {
        type: 'SHOP_DELETE_REQUESTS',
        actorUserId: session.user.id,
        actorName: session.user.name ?? '',
        actorDisplayName: session.user.displayName ?? undefined,
        actorImage: session.user.image ?? undefined,
        targetUserId: deleteRequest.requestedBy,
        content: reviewNote?.trim() || undefined,
        shopId: deleteRequest.shopId,
        shopDeleteRequestId: deleteRequest.id,
        shopDeleteRequestStatus: newStatus,
        shopDeleteRequestType: deleteRequest.photoId ? 'photo' : 'shop',
        shopName: deleteRequest.shopName
      };
      await notify(notification);
    } catch (err) {
      // Non-fatal: log but don't fail the request
      console.error('Failed to send delete request notification:', err);
    }
  }

  // Log to shop changelog (non-fatal)
  try {
    const isPhotoRequest = !!deleteRequest.photoId;
    const changelogAction = isPhotoRequest
      ? action === 'approve'
        ? 'photo_delete_request_approved'
        : 'photo_delete_request_rejected'
      : action === 'approve'
        ? 'delete_request_approved'
        : 'delete_request_rejected';

    await logShopChange(mongo, {
      shopId: deleteRequest.shopId,
      shopName: deleteRequest.shopName,
      action: changelogAction,
      user: { id: session.user.id, name: session.user.name, image: session.user.image },
      fieldInfo: {
        field: isPhotoRequest ? 'photo' : 'delete_request',
        deleteRequestId: deleteRequest.id,
        photoId: deleteRequest.photoId ?? null,
        photoUrl: deleteRequest.photoUrl ?? null
      },
      metadata: {
        ...(reviewNote?.trim() ? { reviewNote: reviewNote.trim() } : {}),
        requestedBy: deleteRequest.requestedBy ?? null
      }
    });
  } catch (logErr) {
    console.error('Failed to log delete request review changelog:', logErr);
  }

  return json(
    shopDeleteRequestReviewResponseSchema.parse({
      success: true,
      status: newStatus
    })
  );
};
