/**
 * Shop photos: the list with uploader information, the streaming upload,
 * and the delete.
 *
 * The upload answers with an NDJSON event stream rather than a JSON body,
 * so it carries no output schema on the contract.
 */

import { implement } from '@orpc/server';
import mongo from '$lib/db/index.server';
import { createUploadedImage, getImagesCollection } from '$lib/images/index.server';
import { deleteFile } from '$lib/oss/index';
import { m } from '$lib/paraglide/messages';
import { shopPhotoUploadEventSchema, shopPhotosResponseSchema } from '$lib/schemas/shops';
import type { Shop } from '$lib/types';
import { toPlainArray } from '$lib/utils';
import { requireBoundPhone } from '$lib/utils/index.server';
import { canModifyShop } from '$lib/utils/shops/authorization.server';
import { logShopChange } from '$lib/utils/shops/changelog.server';
import { apiError } from '../../errors';
import { createNdjsonUploadStream } from '../../ndjson.server';
import { shopsContract } from '../../contracts/shops';
import type { ApiContext } from '../../context';
import { toPlainWire } from './shared.server';

const impl = implement(shopsContract).$context<ApiContext>();

const photosWithUploaderPipeline = (shopId: number, limit?: number) => {
  const pipeline: object[] = [
    { $match: { shopId } },
    { $sort: { uploadedAt: -1 } },
    ...(limit ? [{ $limit: limit }] : []),
    {
      $lookup: {
        from: 'users',
        let: { uid: '$uploadedBy' },
        pipeline: [
          { $match: { $expr: { $eq: ['$id', '$$uid'] } } },
          { $project: { _id: 0, id: 1, name: 1, displayName: 1, image: 1 } }
        ],
        as: 'uploaderArr'
      }
    },
    { $addFields: { uploader: { $arrayElemAt: ['$uploaderArr', 0] } } },
    { $project: { uploaderArr: 0 } }
  ];
  return pipeline;
};

export const shopsPhotosImplementation = {
  /** `GET /api/shops/{id}/photos` */
  photos: impl.photos.handler(async ({ input }) => {
    const shopId = input.id;

    const db = mongo.db();
    const photos = await getImagesCollection(db)
      .aggregate(photosWithUploaderPipeline(shopId))
      .toArray();

    return toPlainWire(shopPhotosResponseSchema, { photos: toPlainArray(photos) });
  }),

  /**
   * `POST /api/shops/{id}/photos`
   *
   * Accepts multipart/form-data with a single "file" field (image).
   * Streams NDJSON back to the client:
   *   {"phase":"uploading","progress":0.5}   – server→OSS progress (0–1)
   *   {"phase":"done","photoId":"…","url":"…"} – success
   *   {"phase":"error","message":"…"}          – failure
   */
  uploadPhoto: impl.uploadPhoto.handler(async ({ input, context }) => {
    const session = context.session;
    if (!session?.user) {
      apiError('UNAUTHORIZED', m.insufficient_permissions());
    }

    requireBoundPhone(session.user);

    const shopId = input.id;

    const db = mongo.db();
    const shop = await db.collection<Shop>('shops').findOne({ id: shopId });
    if (!shop) {
      apiError('NOT_FOUND', m.shop_not_found());
    }

    if (!canModifyShop(shop, session.user)) {
      apiError('FORBIDDEN', m.insufficient_permissions());
    }

    // The multipart body was decoded into the input, so the file is already
    // the one the client uploaded.
    const file = input.file;
    if (!file.type.startsWith('image/')) {
      apiError('BAD_REQUEST', 'file: Only image files are allowed');
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // The upload runs asynchronously so we can return the streaming response immediately
    return createNdjsonUploadStream({
      eventSchema: shopPhotoUploadEventSchema,
      errorMessage: 'Upload failed',
      errorLabel: 'Photo upload error:',
      resHeaders: context.resHeaders,
      upload: async (emit) => {
        // `createUploadedImage` derives the storage key from the owner, uploads
        // the object and inserts the `images` document — the same three steps
        // the avatar endpoints use. Deriving them by hand here had already
        // drifted from the shared key layout.
        const photo = await createUploadedImage({
          db,
          fileName: file.name,
          mimeType: file.type,
          buffer,
          uploadedBy: session.user.id,
          owner: { shopId },
          onProgress: (progress) => emit({ phase: 'uploading', progress })
        });

        // Log to shop changelog (non-fatal)
        try {
          await logShopChange(mongo, {
            shopId,
            shopName: shop.name,
            action: 'photo_uploaded',
            user: { id: session.user.id, name: session.user.name, image: session.user.image },
            fieldInfo: { field: 'photo', photoId: photo.id, photoUrl: photo.url }
          });
        } catch (logErr) {
          console.error('Failed to log photo upload changelog:', logErr);
        }

        emit({
          phase: 'done',
          photoId: photo.id,
          url: photo.url
        });
      }
    });
  }),

  /** `DELETE /api/shops/{id}/photos/{photoId}` */
  deletePhoto: impl.deletePhoto.handler(async ({ input, context }) => {
    const session = context.session;
    if (!session?.user) {
      apiError('UNAUTHORIZED', m.insufficient_permissions());
    }

    requireBoundPhone(session.user);

    const { id: shopId, photoId } = input;

    const db = mongo.db();
    const photosCollection = getImagesCollection(db);
    const [shop, photo] = await Promise.all([
      db.collection<Shop>('shops').findOne({ id: shopId }),
      photosCollection.findOne({ id: photoId, shopId })
    ]);

    if (!photo) {
      apiError('NOT_FOUND', m.shop_photo_not_found());
    }
    if (!shop) {
      apiError('NOT_FOUND', m.shop_not_found());
    }

    const isAdmin = session.user.userType === 'site_admin';
    const isUploader = photo.uploadedBy === session.user.id;

    // Admins can always delete; non-admins need to be both the uploader and pass shop-level checks
    if (!isAdmin && (!isUploader || !canModifyShop(shop, session.user))) {
      apiError('FORBIDDEN', m.insufficient_permissions());
    }

    await deleteFile(photo);
    await photosCollection.deleteOne({ id: photoId });

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

    return { success: true };
  })
};
