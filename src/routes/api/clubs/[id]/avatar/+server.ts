import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { createUploadedImage, deleteImagesByIds, getImagesByIds } from '$lib/images/index.server';
import { checkClubPermission } from '$lib/utils';
import { logChange } from '$lib/utils/universities-clubs/changelog.server';
import type { Club } from '$lib/types';

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

      // checkClubPermission requires the club object, so the DB fetch must happen first
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
      const oldAvatarImageId = club.avatarImageId ?? null;

      // Upload new avatar as an ImageAsset owned by this club
      const image = await createUploadedImage({
        db,
        fileName: file.name,
        mimeType: file.type,
        buffer,
        uploadedBy: session.user.id,
        owner: { clubId },
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

      const oldAvatarUrl = club.avatarUrl ?? null;

      // Update club avatarUrl and avatarImageId
      await clubsCollection.updateOne(
        { id: clubId },
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
