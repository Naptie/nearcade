import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { createUploadedImage, type ImageDraftContext } from '$lib/images/index.server';

const getOptionalStringFromRequest = (
  formData: FormData,
  url: URL,
  key: string
) => {
  const formValue = formData.get(key);
  if (typeof formValue === 'string' && formValue.trim()) {
    return formValue.trim();
  }

  const queryValue = url.searchParams.get(key);
  return queryValue?.trim() || undefined;
};

const getOptionalShopIdFromRequest = (formData: FormData, url: URL) => {
  const value = getOptionalStringFromRequest(formData, url, 'shopId');
  if (!value) return undefined;

  const shopId = Number.parseInt(value, 10);
  if (Number.isNaN(shopId)) {
    error(400, 'Invalid shop id');
  }

  return shopId;
};

export const POST: RequestHandler = async ({ request, locals }) => {
  const session = locals.session;
  if (!session?.user) {
    error(401, m.insufficient_permissions());
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

  const url = new URL(request.url);
  const owner: ImageOwnerReference = {
    shopId: getOptionalShopIdFromRequest(formData, url),
    commentId: getOptionalStringFromRequest(formData, url, 'commentId'),
    postId: getOptionalStringFromRequest(formData, url, 'postId'),
    deleteRequestId: getOptionalStringFromRequest(formData, url, 'deleteRequestId')
  };
  const draftContext: ImageDraftContext = {
    kind: getOptionalStringFromRequest(formData, url, 'draftKind') as ImageDraftContext['kind'],
    organizationType: getOptionalStringFromRequest(formData, url, 'organizationType') as
      | 'university'
      | 'club'
      | undefined,
    organizationId: getOptionalStringFromRequest(formData, url, 'organizationId'),
    postId: getOptionalStringFromRequest(formData, url, 'postId'),
    shopId: getOptionalShopIdFromRequest(formData, url),
    deleteRequestId: getOptionalStringFromRequest(formData, url, 'deleteRequestId')
  };

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const db = mongo.db();

  const encoder = new TextEncoder();
  let streamController!: ReadableStreamDefaultController<Uint8Array>;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    }
  });

  (async () => {
    try {
      const image = await createUploadedImage({
        db,
        fileName: file.name,
        mimeType: file.type,
        buffer,
        uploadedBy: session.user.id,
        owner,
        draftContext,
        onProgress: (progress) => {
          const line = JSON.stringify({ phase: 'uploading', progress }) + '\n';
          streamController.enqueue(encoder.encode(line));
        }
      });

      const line =
        JSON.stringify({
          phase: 'done',
          imageId: image.id,
          url: image.url,
          storageProvider: image.storageProvider,
          storageKey: image.storageKey,
          storageObjectId: image.storageObjectId ?? null
        }) + '\n';
      streamController.enqueue(encoder.encode(line));
      streamController.close();
    } catch (err) {
      console.error('Image upload error:', err);
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
