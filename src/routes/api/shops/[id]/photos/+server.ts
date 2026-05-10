import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { m } from '$lib/paraglide/messages';
import { uploadFile } from '$lib/oss/index';
import { toPlainArray, toPlainObject } from '$lib/utils';
import { logShopChange } from '$lib/utils/shops/changelog.server';
import { IMAGE_STORAGE_PREFIX } from '$lib/constants';
import {
  shopIdParamSchema,
  shopPhotoSchema,
  shopPhotosResponseSchema,
  shopPhotoUploadEventSchema
} from '$lib/schemas/shops';
import { parseOrError, parseParamsOrError } from '$lib/utils/validation.server';

const shopPhotoUploadFormDataSchema = z.object({
  file: z
    .instanceof(File)
    .refine((file) => file.type.startsWith('image/'), 'Only image files are allowed')
});

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

/**
 * GET /api/shops/:id/photos
 * Returns all photos for a shop, with uploader data joined via $lookup.
 */
export const GET: RequestHandler = async ({ params }) => {
  const { id: shopId } = parseParamsOrError(shopIdParamSchema, params);

  const db = mongo.db();
  const photos = await db
    .collection('images')
    .aggregate(photosWithUploaderPipeline(shopId))
    .toArray();

  const response = shopPhotosResponseSchema.parse({
    photos: toPlainArray(photos)
  });

  return json(response);
};

/**
 * POST /api/shops/:id/photos
 * Accepts multipart/form-data with a single "file" field (image).
 * Streams NDJSON back to the client:
 *   {"phase":"uploading","progress":0.5}   – server→OSS progress (0–1)
 *   {"phase":"done","photoId":"…","url":"…"} – success
 *   {"phase":"error","message":"…"}          – failure
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
  const session = locals.session;
  if (!session?.user) {
    error(401, m.insufficient_permissions());
  }

  const { id: shopId } = parseParamsOrError(shopIdParamSchema, params);

  const db = mongo.db();
  const shop = await db.collection('shops').findOne({ id: shopId });
  if (!shop) {
    error(404, m.shop_not_found());
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    error(400, 'Invalid form data');
  }

  const { file } = parseOrError(shopPhotoUploadFormDataSchema, {
    file: formData.get('file')
  });

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Generate a stable photo ID and derive a unique OSS object name
  const photoId = nanoid();
  const ext = (file.name.split('.').pop() || file.type.split('/')[1] || 'jpg').toLowerCase();
  const ossName = `${IMAGE_STORAGE_PREFIX}/images/shops/${shopId}/${photoId}.${ext}`;

  const encoder = new TextEncoder();
  let streamController!: ReadableStreamDefaultController<Uint8Array>;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    }
  });

  const enqueueEvent = (event: unknown) => {
    const payload = shopPhotoUploadEventSchema.parse(event);
    streamController.enqueue(encoder.encode(JSON.stringify(payload) + '\n'));
  };

  // Run the OSS upload asynchronously so we can return the streaming response immediately
  (async () => {
    try {
      const uploadedFile = await uploadFile(ossName, buffer, (progress) => {
        enqueueEvent({ phase: 'uploading', progress });
      });

      const photo = shopPhotoSchema.parse(
        toPlainObject({
          id: photoId,
          shopId,
          url: uploadedFile.url,
          storageProvider: uploadedFile.storageProvider,
          storageKey: uploadedFile.storageKey,
          storageObjectId: uploadedFile.storageObjectId ?? null,
          uploadedBy: session.user.id,
          uploadedAt: new Date()
        })
      );
      const photoDocument: Omit<typeof photo, '_id'> = {
        ...photo
      };
      await db.collection('images').insertOne(photoDocument);

      // Log to shop changelog (non-fatal)
      try {
        await logShopChange(mongo, {
          shopId,
          shopName: shop.name,
          action: 'photo_uploaded',
          user: { id: session.user.id, name: session.user.name, image: session.user.image },
          fieldInfo: { field: 'photo', photoId, photoUrl: uploadedFile.url }
        });
      } catch (logErr) {
        console.error('Failed to log photo upload changelog:', logErr);
      }

      enqueueEvent({
        phase: 'done',
        photoId,
        url: uploadedFile.url,
        storageProvider: uploadedFile.storageProvider,
        storageKey: uploadedFile.storageKey,
        storageObjectId: uploadedFile.storageObjectId ?? null
      });
      streamController.close();
    } catch (err) {
      console.error('Photo upload error:', err);
      try {
        enqueueEvent({ phase: 'error', message: 'Upload failed' });
        streamController.close();
      } catch {
        // controller may already be closed
      }
    }
  })();

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'X-Accel-Buffering': 'no',
      'Cache-Control': 'no-cache'
    }
  });
};
