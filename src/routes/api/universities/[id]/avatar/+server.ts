import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { createUploadedImage, deleteImagesByIds, getImagesByIds } from '$lib/images/index.server';
import { checkUniversityPermission } from '$lib/utils';
import { logChange } from '$lib/utils/universities-clubs/changelog.server';
import type { University } from '$lib/types';

export const POST: RequestHandler = async ({ request, locals, params }) => {
  const session = locals.session;
  if (!session?.user) {
    error(401, m.insufficient_permissions());
  }

  const { id } = params;

  const permissions = await checkUniversityPermission(session.user, id, mongo);
  if (!permissions.canEdit) {
    error(403, m.privilege_insufficient());
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
      const db = mongo.db();
      const universitiesCollection = db.collection<University>('universities');

      const university = await universitiesCollection.findOne({
        $or: [{ id }, { slug: id }]
      });

      if (!university) {
        const line = JSON.stringify({ phase: 'error', message: m.university_not_found() }) + '\n';
        streamController.enqueue(encoder.encode(line));
        streamController.close();
        return;
      }

      const universityId = university.id;
      const oldAvatarImageId = university.avatarImageId ?? null;

      // Upload new avatar as an ImageAsset owned by this university
      const image = await createUploadedImage({
        db,
        fileName: file.name,
        mimeType: file.type,
        buffer,
        uploadedBy: session.user.id,
        owner: { universityId },
        onProgress: (progress) => {
          const line = JSON.stringify({ phase: 'uploading', progress }) + '\n';
          streamController.enqueue(encoder.encode(line));
        }
      });

      // Delete old avatar image (OSS + images collection)
      if (oldAvatarImageId) {
        const oldImages = await getImagesByIds(db, [oldAvatarImageId]);
        if (oldImages.length > 0) {
          await deleteImagesByIds(db, [oldAvatarImageId], {
            userId: session.user.id,
            skipPermissionCheck: true
          });
        }
      }

      const oldAvatarUrl = university.avatarUrl ?? null;

      // Update university avatarUrl and avatarImageId
      await universitiesCollection.updateOne(
        { id: universityId },
        {
          $set: {
            avatarUrl: image.url,
            avatarImageId: image.id,
            updatedAt: new Date()
          }
        }
      );

      // Log the avatar change to changelog
      await logChange(mongo, {
        type: 'university',
        targetId: universityId,
        action: 'modified',
        user: {
          id: session.user.id,
          name: session.user.name,
          image: session.user.image
        },
        fieldInfo: { field: 'avatarUrl' },
        oldValue: oldAvatarUrl,
        newValue: image.url
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
      console.error('University avatar upload error:', err);
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
