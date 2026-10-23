import { implement } from '@orpc/server';
import { imagesContract } from '../contracts/images';
import type { ApiContext } from '../context';
import { apiError, parseOrApiError, rethrowApiError, toWire } from '../errors';
import mongo from '$lib/db/index.server';
import { requireBoundPhone } from '$lib/utils/index.server';
import { m } from '$lib/paraglide/messages';
import {
  createUploadedImage,
  deleteImagesByIds,
  getImagesByIds,
  type ImageDraftContext,
  type ImageOwnerReference
} from '$lib/images/index.server';
import { imageUploadEventSchema, imageUploadFormDataSchema } from '$lib/schemas/images';
import { successResponseSchema } from '$lib/schemas/common';
import { createNdjsonUploadStream } from '../ndjson.server';

const SHOP_IMAGE_DRAFT_KINDS = new Set([
  'shop-comment',
  'shop-delete-request',
  'delete-request-comment'
]);

const impl = implement(imagesContract).$context<ApiContext>();

export const imagesImplementation = {
  upload: impl.upload.handler(async ({ input, context }) => {
    const session = context.session;
    if (!session?.user) {
      apiError('UNAUTHORIZED', m.insufficient_permissions());
    }

    // The owner references may also arrive as query parameters; the form field
    // wins when both are present.
    const url = context.event.url;
    const {
      file,
      shopId,
      commentId,
      postId,
      announcementId,
      deleteRequestId,
      draftKind,
      organizationType,
      organizationId
    } = parseOrApiError(imageUploadFormDataSchema, {
      file: input.file,
      shopId: input.shopId ?? url.searchParams.get('shopId'),
      commentId: input.commentId ?? url.searchParams.get('commentId'),
      postId: input.postId ?? url.searchParams.get('postId'),
      announcementId: input.announcementId ?? url.searchParams.get('announcementId'),
      deleteRequestId: input.deleteRequestId ?? url.searchParams.get('deleteRequestId'),
      draftKind: input.draftKind ?? url.searchParams.get('draftKind'),
      organizationType: input.organizationType ?? url.searchParams.get('organizationType'),
      organizationId: input.organizationId ?? url.searchParams.get('organizationId')
    });
    const owner: ImageOwnerReference = draftKind
      ? {}
      : {
          shopId,
          commentId,
          postId,
          announcementId,
          deleteRequestId
        };
    const draftContext: ImageDraftContext = {
      kind: draftKind,
      organizationType,
      organizationId,
      postId,
      announcementId,
      shopId,
      deleteRequestId
    };

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const db = mongo.db();

    const isShopRelatedDraft = draftKind ? SHOP_IMAGE_DRAFT_KINDS.has(draftKind) : false;
    const isShopRelatedOwner = shopId !== undefined || deleteRequestId !== undefined;
    let isShopRelatedCommentOwner = false;

    if (commentId && !isShopRelatedDraft && !isShopRelatedOwner) {
      const comment = await db
        .collection<{ id: string; shopId?: number; shopDeleteRequestId?: string }>('comments')
        .findOne(
          { id: commentId },
          { projection: { _id: 0, id: 1, shopId: 1, shopDeleteRequestId: 1 } }
        );

      isShopRelatedCommentOwner = !!comment?.shopId || !!comment?.shopDeleteRequestId;
    }

    if (isShopRelatedDraft || isShopRelatedOwner || isShopRelatedCommentOwner) {
      requireBoundPhone(session.user);
    }

    return createNdjsonUploadStream({
      eventSchema: imageUploadEventSchema,
      errorMessage: m.image_upload_failed(),
      errorLabel: 'Image upload error:',
      resHeaders: context.resHeaders,
      upload: async (emit) => {
        const image = await createUploadedImage({
          db,
          fileName: file.name,
          mimeType: file.type,
          buffer,
          uploadedBy: session.user.id,
          owner,
          draftContext,
          onProgress: (progress) => {
            emit({ phase: 'uploading', progress });
          }
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
  }),

  remove: impl.remove.handler(async ({ input, context }) => {
    const session = context.session;
    if (!session?.user?.id) {
      apiError('UNAUTHORIZED', m.unauthorized());
    }

    const { imageId } = input;

    try {
      const db = mongo.db();
      const images = await getImagesByIds(db, [imageId]);
      if (images.length === 0) {
        apiError('NOT_FOUND', 'Image not found');
      }

      const image = images[0];
      let isShopRelatedCommentOwner = false;

      if (!image.shopId && !image.deleteRequestId && image.commentId) {
        const comment = await db
          .collection<{ id: string; shopId?: number; shopDeleteRequestId?: string }>('comments')
          .findOne(
            { id: image.commentId },
            { projection: { _id: 0, id: 1, shopId: 1, shopDeleteRequestId: 1 } }
          );

        isShopRelatedCommentOwner = !!comment?.shopId || !!comment?.shopDeleteRequestId;
      }

      if (image.shopId || image.deleteRequestId || isShopRelatedCommentOwner) {
        requireBoundPhone(session.user);
      }

      await deleteImagesByIds(db, [imageId], {
        userId: session.user.id,
        userType: session.user.userType
      });

      return toWire(successResponseSchema, { success: true });
    } catch (err) {
      rethrowApiError(err, m.internal_server_error());
    }
  })
};
