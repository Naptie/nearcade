import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { createUploadedImage, deleteImagesByIds, getImagesByIds } from '$lib/images/index.server';
import { avatarUploadResponseSchema } from '$lib/schemas/users';
import { imageUploadFormDataSchema } from '$lib/schemas/images';
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

  const { file } = parseOrError(imageUploadFormDataSchema.pick({ file: true }), {
    file: formData.get('file')
  });

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const encoder = new TextEncoder();
  let streamController!: ReadableStreamDefaultController<Uint8Array>;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    }
  });

  const enqueueEvent = (event: unknown) => {
    const payload = avatarUploadResponseSchema.parse(event);
    streamController.enqueue(encoder.encode(JSON.stringify(payload) + '\n'));
  };

  (async () => {
    try {
      const userId = session.user.id;
      const db = mongo.db();
      const usersCollection = db.collection('users');

      // Get current user to find the old avatar image ID
      const user = await usersCollection.findOne({ id: userId });
      const oldAvatarImageId = user?.avatarImageId ?? null;

      // Upload new avatar as an ImageAsset owned by this user
      const image = await createUploadedImage({
        db,
        fileName: file.name,
        mimeType: file.type,
        buffer,
        uploadedBy: userId,
        owner: { userId },
        onProgress: (progress) => {
          enqueueEvent({ phase: 'uploading', progress });
        }
      });

      // Delete old avatar image (OSS + images collection)
      if (oldAvatarImageId) {
        const oldImages = await getImagesByIds(db, [oldAvatarImageId]);
        if (oldImages.length > 0) {
          await deleteImagesByIds(db, [oldAvatarImageId], { userId, skipPermissionCheck: true });
        }
      }

      // Update user image URL and avatarImageId
      await usersCollection.updateOne(
        { id: userId },
        {
          $set: {
            image: image.url,
            avatarImageId: image.id,
            updatedAt: new Date()
          }
        }
      );

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
      console.error('User avatar upload error:', err);
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
