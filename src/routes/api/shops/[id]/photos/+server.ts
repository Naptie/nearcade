import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Shop, ShopPhoto } from '$lib/types';
import mongo from '$lib/db/index.server';
import { nanoid } from 'nanoid';
import { m } from '$lib/paraglide/messages';
import { upload } from '$lib/oss/index';
import { toPlainArray } from '$lib/utils';

/**
 * GET /api/shops/:id/photos
 * Returns all photos for a shop.
 */
export const GET: RequestHandler = async ({ params }) => {
  const { id } = params;
  const shopId = parseInt(id);
  if (isNaN(shopId)) {
    error(400, m.invalid_shop_id());
  }

  const db = mongo.db();
  const photos = await db
    .collection<ShopPhoto>('shop_photos')
    .find({ shopId })
    .sort({ uploadedAt: -1 })
    .toArray();

  return json({ photos: toPlainArray(photos) });
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

  const { id } = params;
  const shopId = parseInt(id);
  if (isNaN(shopId)) {
    error(400, m.invalid_shop_id());
  }

  const db = mongo.db();
  const shop = await db.collection<Shop>('shops').findOne({ id: shopId });
  if (!shop) {
    error(404, m.shop_not_found());
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    error(400, 'Invalid form data');
  }

  const file = formData.get('file') as File | null;
  if (!file) {
    error(400, 'A file is required');
  }
  if (!file.type.startsWith('image/')) {
    error(400, 'Only image files are allowed');
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Generate a stable photo ID and derive a unique OSS object name
  const photoId = nanoid();
  const ext = (file.name.split('.').pop() || file.type.split('/')[1] || 'jpg').toLowerCase();
  const ossName = `shop-photos/${shopId}/${photoId}.${ext}`;

  const encoder = new TextEncoder();
  let streamController!: ReadableStreamDefaultController<Uint8Array>;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    }
  });

  // Run the OSS upload asynchronously so we can return the streaming response immediately
  (async () => {
    try {
      const url = await upload(ossName, buffer, (progress) => {
        const line = JSON.stringify({ phase: 'uploading', progress }) + '\n';
        streamController.enqueue(encoder.encode(line));
      });

      const photo: ShopPhoto = {
        id: photoId,
        shopId,
        shopName: shop.name,
        url,
        uploadedBy: session.user.id,
        uploadedByName: session.user.name ?? null,
        uploadedAt: new Date()
      };
      await db.collection<ShopPhoto>('shop_photos').insertOne(photo);

      const line = JSON.stringify({ phase: 'done', photoId, url }) + '\n';
      streamController.enqueue(encoder.encode(line));
      streamController.close();
    } catch (err) {
      console.error('Photo upload error:', err);
      const line = JSON.stringify({ phase: 'error', message: 'Upload failed' }) + '\n';
      try {
        streamController.enqueue(encoder.encode(line));
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
