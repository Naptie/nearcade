import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { deleteFile, uploadFile } from '$lib/oss/index';
import { IMAGE_STORAGE_PREFIX } from '$lib/constants';
import { checkClubPermission } from '$lib/utils';
import { logChange } from '$lib/utils/universities-clubs/changelog.server';
import { nanoid } from 'nanoid';
import type { Club, ImageStorageProvider } from '$lib/types';

const getAvatarExtension = (fileName: string, mimeType: string) =>
  (fileName.split('.').pop() || mimeType.split('/')[1] || 'jpg').toLowerCase();

export const POST: RequestHandler = async ({ request, locals, params }) => {
  const session = locals.session;
  if (!session?.user) {
    error(401, m.insufficient_permissions());
  }

  const { id } = params;

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
      const db = mongo.db();
      const clubsCollection = db.collection<Club>('clubs');

      const club = await clubsCollection.findOne({
        $or: [{ id }, { slug: id }]
      });

      if (!club) {
        const line = JSON.stringify({ phase: 'error', message: m.club_not_found() }) + '\n';
        streamController.enqueue(encoder.encode(line));
        streamController.close();
        return;
      }

      const permissions = await checkClubPermission(session.user, club, mongo);
      if (!permissions.canEdit) {
        const line = JSON.stringify({ phase: 'error', message: m.privilege_insufficient() }) + '\n';
        streamController.enqueue(encoder.encode(line));
        streamController.close();
        return;
      }

      const clubId = club.id;
      const avatarId = nanoid();
      const extension = getAvatarExtension(file.name, file.type);
      const storageKey = `${IMAGE_STORAGE_PREFIX}/avatars/clubs/${clubId}/${avatarId}.${extension}`;

      const uploadedFile = await uploadFile(storageKey, buffer, (progress) => {
        const line = JSON.stringify({ phase: 'uploading', progress }) + '\n';
        streamController.enqueue(encoder.encode(line));
      });

      // Delete old avatar from OSS if it was stored there
      if (club.avatarStorageKey && club.avatarStorageProvider) {
        try {
          await deleteFile({
            storageProvider: club.avatarStorageProvider as ImageStorageProvider,
            storageKey: club.avatarStorageKey,
            storageObjectId: club.avatarStorageObjectId ?? null
          });
        } catch (err) {
          console.error('Failed to delete old club avatar from OSS:', err);
        }
      }

      const oldAvatarUrl = club.avatarUrl ?? null;

      // Update club avatarUrl and storage metadata
      await clubsCollection.updateOne(
        { id: clubId },
        {
          $set: {
            avatarUrl: uploadedFile.url,
            avatarStorageProvider: uploadedFile.storageProvider,
            avatarStorageKey: uploadedFile.storageKey,
            avatarStorageObjectId: uploadedFile.storageObjectId ?? null,
            updatedAt: new Date()
          }
        }
      );

      // Log the avatar change to changelog
      await logChange(mongo, {
        type: 'club',
        targetId: clubId,
        action: 'modified',
        user: {
          id: session.user.id,
          name: session.user.name,
          image: session.user.image
        },
        fieldInfo: { field: 'avatarUrl' },
        oldValue: oldAvatarUrl,
        newValue: uploadedFile.url
      });

      const line =
        JSON.stringify({
          phase: 'done',
          imageId: clubId,
          url: uploadedFile.url,
          storageProvider: uploadedFile.storageProvider,
          storageKey: uploadedFile.storageKey,
          storageObjectId: uploadedFile.storageObjectId ?? null
        }) + '\n';
      streamController.enqueue(encoder.encode(line));
      streamController.close();
    } catch (err) {
      console.error('Club avatar upload error:', err);
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
