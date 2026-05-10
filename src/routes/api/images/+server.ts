import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import {
  createUploadedImage,
  type ImageDraftContext,
  type ImageOwnerReference
} from '$lib/images/index.server';
import { imageUploadEventSchema, imageUploadFormDataSchema } from '$lib/schemas/images';
import { parseOrError } from '$lib/utils/validation.server';

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

  const url = new URL(request.url);
  const {
    file,
    shopId,
    commentId,
    postId,
    deleteRequestId,
    draftKind,
    organizationType,
    organizationId
  } = parseOrError(imageUploadFormDataSchema, {
    file: formData.get('file'),
    shopId: formData.get('shopId') ?? url.searchParams.get('shopId'),
    commentId: formData.get('commentId') ?? url.searchParams.get('commentId'),
    postId: formData.get('postId') ?? url.searchParams.get('postId'),
    deleteRequestId: formData.get('deleteRequestId') ?? url.searchParams.get('deleteRequestId'),
    draftKind: formData.get('draftKind') ?? url.searchParams.get('draftKind'),
    organizationType:
      formData.get('organizationType') ?? url.searchParams.get('organizationType'),
    organizationId: formData.get('organizationId') ?? url.searchParams.get('organizationId')
  });
  const owner: ImageOwnerReference = {
    shopId,
    commentId,
    postId,
    deleteRequestId
  };
  const draftContext: ImageDraftContext = {
    kind: draftKind as ImageDraftContext['kind'],
    organizationType,
    organizationId,
    postId,
    shopId,
    deleteRequestId
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

  const enqueueEvent = (event: unknown) => {
    const payload = imageUploadEventSchema.parse(event);
    streamController.enqueue(encoder.encode(JSON.stringify(payload) + '\n'));
  };

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
          enqueueEvent({ phase: 'uploading', progress });
        }
      });

      enqueueEvent({
        phase: 'done',
        imageId: image.id,
        url: image.url,
        storageProvider: image.storageProvider,
        storageKey: image.storageKey,
        storageObjectId: image.storageObjectId ?? null
      });
      streamController.close();
    } catch (err) {
      console.error('Image upload error:', err);
      try {
        enqueueEvent({ phase: 'error', message: m.image_upload_failed() });
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
