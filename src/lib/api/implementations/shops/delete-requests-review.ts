/**
 * Deciding what happens to a delete request: approving or rejecting it, and
 * retracting or removing it.
 *
 * Approving a request is the only path that actually removes a shop or a
 * photo — the request itself is just bookkeeping until then.
 */

import mongo from '$lib/db/index.server';
import { removeShopDocument } from '$lib/db/meili.server';
import { deleteImagesForOwner } from '$lib/images/index.server';
import { notify } from '$lib/notifications/index.server';
import { deleteFile } from '$lib/oss/index';
import { m } from '$lib/paraglide/messages';
import { purgeUgcEntities } from '$lib/ugc/entries.server';
import { requireBoundPhone } from '$lib/utils/index.server';
import { logShopChange } from '$lib/utils/shops/changelog.server';
import { apiError } from '../../errors';
import { impl } from './delete-requests-shared';
import type { ShopPhotoEntry } from './shared';

export const shopsDeleteRequestsReviewImplementation = {
  /**
   * `DELETE /api/shops/delete-requests/{id}`
   * - Submitter can retract their own pending request
   * - Admin can delete any request regardless of status
   */
  deleteDeleteRequest: impl.deleteDeleteRequest.handler(async ({ input, context }) => {
    const session = context.session;
    if (!session?.user) {
      apiError('UNAUTHORIZED', m.insufficient_permissions());
    }

    requireBoundPhone(session.user);

    const { id } = input;
    const db = mongo.db();
    const deleteRequestsCollection = db.collection('shop_delete_requests');

    const deleteRequest = await deleteRequestsCollection.findOne({ id });

    if (!deleteRequest) {
      apiError('NOT_FOUND', m.shop_delete_request_not_found());
    }

    const isAdmin = session.user.userType === 'site_admin';
    const isRequester = deleteRequest.requestedBy === session.user.id;

    if (!isAdmin && !isRequester) {
      apiError('FORBIDDEN', m.insufficient_permissions());
    }

    // Non-admins can only retract pending requests
    if (!isAdmin && deleteRequest.status !== 'pending') {
      apiError('BAD_REQUEST', 'Can only retract pending requests');
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
    await purgeUgcEntities('delete_request', [id]);

    // Notify the requester when an admin deletes their request
    if (isAdmin && !isRequester && deleteRequest.requestedBy) {
      try {
        await notify({
          type: 'SHOP_DELETE_REQUESTS',
          actorUserId: session.user.id,
          actorName: session.user.name ?? '',
          actorDisplayName: session.user.displayName ?? undefined,
          actorImage: session.user.image ?? undefined,
          targetUserId: deleteRequest.requestedBy,
          shopId: deleteRequest.shopId,
          shopDeleteRequestId: deleteRequest.id,
          shopDeleteRequestStatus: 'deleted',
          shopDeleteRequestType: deleteRequest.photoId ? 'photo' : 'shop',
          shopName: deleteRequest.shopName
        });
      } catch (err) {
        console.error('Failed to send delete request deletion notification:', err);
      }
    }

    return { success: true };
  }),

  /**
   * `PATCH /api/shops/delete-requests/{id}`
   * Body: { action: 'approve' | 'reject', reviewNote?: string }
   * Admin only: approve or reject a pending request
   */
  reviewDeleteRequest: impl.reviewDeleteRequest.handler(async ({ input, context }) => {
    const session = context.session;
    if (!session?.user || session.user.userType !== 'site_admin') {
      apiError('FORBIDDEN', m.insufficient_permissions());
    }

    requireBoundPhone(session.user);

    const { id } = input;
    const { action, reviewNote } = input;

    const db = mongo.db();
    const deleteRequestsCollection = db.collection('shop_delete_requests');
    const photosCollection = db.collection<ShopPhotoEntry>('images');

    const deleteRequest = await deleteRequestsCollection.findOne({ id });

    if (!deleteRequest) {
      apiError('NOT_FOUND', m.shop_delete_request_not_found());
    }

    if (deleteRequest.status !== 'pending') {
      apiError('CONFLICT', 'Request has already been processed');
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
        const shop = await db.collection('shops').findOne({ id: deleteRequest.shopId });

        if (shop) {
          await db.collection('deleted_shops').insertOne({
            ...shop,
            deletedAt: now,
            deletedBy: session.user.id,
            deleteRequestId: deleteRequest.id
          });
          await db.collection('shops').deleteOne({ id: deleteRequest.shopId });
          try {
            await removeShopDocument(String(shop._id));
          } catch (meiliErr) {
            console.error('Failed to remove deleted shop from Meilisearch:', meiliErr);
          }
        } else {
          // The shop is no longer in `shops` — it was already moved to
          // `deleted_shops`, typically by an external sync process rather than
          // through this endpoint.
          const existingDeletedShop = await db
            .collection('deleted_shops')
            .findOne({ id: deleteRequest.shopId });
          if (existingDeletedShop) {
            if (!existingDeletedShop.deleteRequestId) {
              await db
                .collection('deleted_shops')
                .updateOne(
                  { id: deleteRequest.shopId },
                  { $set: { deleteRequestId: deleteRequest.id } }
                );
            }
            try {
              await removeShopDocument(String(existingDeletedShop._id));
            } catch (meiliErr) {
              console.error('Failed to remove deleted shop from Meilisearch:', meiliErr);
            }
          }
          // If the shop is in neither collection, there is nothing to move —
          // the request is still marked approved below.
        }
        await purgeUgcEntities('shop', [deleteRequest.shopId]);
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

    return {
      success: true,
      status: newStatus
    };
  })
};
