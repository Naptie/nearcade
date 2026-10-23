/**
 * The university avatar upload.
 *
 * The response is an NDJSON event stream rather than a JSON document: the
 * upload reports its progress while it runs and finishes with the stored
 * image, so the browser can show the picture before the request is done.
 */
import { implement } from '@orpc/server';
import { universitiesContract } from '../../contracts/universities';
import type { ApiContext } from '../../context';
import { apiError } from '../../errors';
import { createNdjsonUploadStream } from '../../ndjson.server';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { checkUniversityPermission } from '$lib/utils';
import { formatZodError } from '$lib/utils/validation';
import { createUploadedImage, deleteImagesByIds, getImagesByIds } from '$lib/images/index.server';
import { logChange } from '$lib/utils/universities-clubs/changelog.server';
import { avatarUploadResponseSchema } from '$lib/schemas/users';
import { avatarUploadFormDataSchema } from '$lib/schemas/images';
import { type University } from '$lib/types';
import { findUniversityByRouteId } from './shared';

const impl = implement(universitiesContract).$context<ApiContext>();

export const universitiesAvatarImplementation = {
  uploadAvatar: impl.uploadAvatar.handler(async ({ input, context }) => {
    const session = context.session;
    if (!session?.user) {
      apiError('UNAUTHORIZED', m.insufficient_permissions());
    }

    const { id } = input;

    const permissions = await checkUniversityPermission(session.user, id, mongo);
    if (!permissions.canEdit) {
      apiError('FORBIDDEN', m.privilege_insufficient());
    }

    // oRPC already read the multipart body, so the uploaded file arrives as
    // `input.file`; re-reading `request.formData()` would fail on a used body.
    const parsedFile = avatarUploadFormDataSchema.safeParse({ file: input.file });
    if (!parsedFile.success) {
      apiError('BAD_REQUEST', formatZodError(parsedFile.error));
    }
    const { file } = parsedFile.data;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return createNdjsonUploadStream({
      eventSchema: avatarUploadResponseSchema,
      errorMessage: m.image_upload_failed(),
      errorLabel: 'University avatar upload error:',
      resHeaders: context.resHeaders,
      upload: async (emit) => {
        const db = mongo.db();
        const universitiesCollection = db.collection<University>('universities');

        const university = await findUniversityByRouteId(id);

        if (!university) {
          emit({ phase: 'error', message: m.university_not_found() });
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
            emit({ phase: 'uploading', progress });
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

        emit({
          phase: 'done',
          imageId: image.id,
          url: image.url,
          storageProvider: image.storageProvider,
          storageKey: image.storageKey,
          storageObjectId: image.storageObjectId ?? null
        });
      }
    });
  })
};
