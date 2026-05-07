import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { deleteFile, uploadFile } from '$lib/oss/index';
import { IMAGE_STORAGE_PREFIX } from '$lib/constants';
import { nanoid } from 'nanoid';
import type { ImageStorageProvider } from '$lib/types';

const getAvatarExtension = (fileName: string, mimeType: string) =>
  (fileName.split('.').pop() || mimeType.split('/')[1] || 'jpg').toLowerCase();

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

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const encoder = new TextEncoder();
  let streamController!: ReadableStreamDefaultController<Uint8Array>;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    }
  });

  (async () => {
    try {
      const userId = session.user.id;
      const db = mongo.db();
      const usersCollection = db.collection('users');

      // Get current user to check for existing avatar in OSS
      const user = await usersCollection.findOne({ id: userId });

      const avatarId = nanoid();
      const extension = getAvatarExtension(file.name, file.type);
      const storageKey = `${IMAGE_STORAGE_PREFIX}/avatars/users/${userId}/${avatarId}.${extension}`;

      const uploadedFile = await uploadFile(storageKey, buffer, (progress) => {
        const line = JSON.stringify({ phase: 'uploading', progress }) + '\n';
        streamController.enqueue(encoder.encode(line));
      });

      // Delete old avatar from OSS if it was stored there
      if (user?.avatarStorageKey && user?.avatarStorageProvider) {
        try {
          await deleteFile({
            storageProvider: user.avatarStorageProvider as ImageStorageProvider,
            storageKey: user.avatarStorageKey,
            storageObjectId: user.avatarStorageObjectId ?? null
          });
        } catch (err) {
          console.error('Failed to delete old user avatar from OSS:', err);
        }
      }

      // Update user image and storage metadata
      await usersCollection.updateOne(
        { id: userId },
        {
          $set: {
            image: uploadedFile.url,
            avatarStorageProvider: uploadedFile.storageProvider,
            avatarStorageKey: uploadedFile.storageKey,
            avatarStorageObjectId: uploadedFile.storageObjectId ?? null,
            updatedAt: new Date()
          }
        }
      );

      const line =
        JSON.stringify({
          phase: 'done',
          imageId: userId,
          url: uploadedFile.url,
          storageProvider: uploadedFile.storageProvider,
          storageKey: uploadedFile.storageKey,
          storageObjectId: uploadedFile.storageObjectId ?? null
        }) + '\n';
      streamController.enqueue(encoder.encode(line));
      streamController.close();
    } catch (err) {
      console.error('User avatar upload error:', err);
      const line = JSON.stringify({ phase: 'error', message: m.image_upload_failed() }) + '\n';
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
