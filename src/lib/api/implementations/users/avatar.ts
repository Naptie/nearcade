/**
 * The avatar upload of the signed-in user.
 *
 * The endpoint answers with an NDJSON event stream — the upload reports its
 * progress while it runs — so the body is a byte stream and not a JSON
 * document.
 */

import { implement } from '@orpc/server';
import mongo from '$lib/db/index.server';
import { createUploadedImage, deleteImagesByIds, getImagesByIds } from '$lib/images/index.server';
import { m } from '$lib/paraglide/messages';
import { avatarUploadFormDataSchema } from '$lib/schemas/images';
import { avatarUploadResponseSchema } from '$lib/schemas/users';
import { usersContract } from '../../contracts/users';
import type { ApiContext } from '../../context';
import { apiError, parseOrApiError } from '../../errors';
import { createNdjsonUploadStream } from '../../ndjson.server';

const impl = implement(usersContract).$context<ApiContext>();

export const usersAvatarImplementation = {
  uploadAvatar: impl.uploadAvatar.handler(async ({ input, context }) => {
    const session = context.session;
    if (!session?.user) {
      apiError('UNAUTHORIZED', m.insufficient_permissions());
    }

    const { file } = parseOrApiError(avatarUploadFormDataSchema, { file: input.file });

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return createNdjsonUploadStream({
      eventSchema: avatarUploadResponseSchema,
      errorMessage: m.image_upload_failed(),
      errorLabel: 'User avatar upload error:',
      resHeaders: context.resHeaders,
      upload: async (emit) => {
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
            emit({ phase: 'uploading', progress });
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

        emit({
          phase: 'done',
          imageId: image.id,
          url: image.url
        });
      }
    });
  })
};
