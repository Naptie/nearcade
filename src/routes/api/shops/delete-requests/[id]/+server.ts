import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Shop, ShopDeleteRequest, Notification } from '$lib/types';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { notify } from '$lib/notifications/index.server';

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

  const { id } = params;
  const db = mongo.db();

  const deleteRequest = await db
    .collection<ShopDeleteRequest>('shop_delete_requests')
    .findOne({ id });

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

  await db.collection('shop_delete_requests').deleteOne({ id });

  return json({ success: true });
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

  const { id } = params;

  let body: { action?: string; reviewNote?: string };
  try {
    body = await request.json();
  } catch {
    error(400, 'Invalid request body');
  }

  const { action, reviewNote } = body;
  if (action !== 'approve' && action !== 'reject') {
    error(400, 'action must be "approve" or "reject"');
  }

  const db = mongo.db();

  const deleteRequest = await db
    .collection<ShopDeleteRequest>('shop_delete_requests')
    .findOne({ id });

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
      // Delete the specific photo
      await db.collection('shop_photos').deleteOne({ id: deleteRequest.photoId });
    } else {
      // Delete the shop
      await db.collection<Shop>('shops').deleteOne({ id: deleteRequest.shopId });
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
      const notification: Omit<Notification, 'id' | 'createdAt'> = {
        type: 'SHOP_DELETE_REQUESTS',
        actorUserId: session.user.id,
        actorName: session.user.name ?? '',
        actorDisplayName: session.user.displayName ?? undefined,
        actorImage: session.user.image ?? undefined,
        targetUserId: deleteRequest.requestedBy,
        content: deleteRequest.reviewNote || undefined,
        shopDeleteRequestId: deleteRequest.id,
        shopDeleteRequestStatus: newStatus,
        shopName: deleteRequest.shopName
      };
      await notify(notification);
    } catch (err) {
      // Non-fatal: log but don't fail the request
      console.error('Failed to send delete request notification:', err);
    }
  }

  return json({ success: true, status: newStatus });
};
