import { z } from 'zod';

import {
  bilingual,
  dateTimeSchema,
  objectIdSchema,
  shopIdParamSchema,
  userIdSchema,
  userPublicSchema
} from './common';

export const imageAssetIdSchema = z.string().describe(bilingual('图片资源 ID。', 'Image asset ID.'));

export const imageIdParamSchema = z.object({
  imageId: imageAssetIdSchema
});

export const imageStorageProviderSchema = z
  .enum(['s3', 'leancloud'])
  .describe(bilingual('图片存储提供商。', 'Image storage provider.'));

export const imageAssetSchema = z
  .object({
    _id: z
      .union([z.string(), objectIdSchema])
      .optional()
      .describe(bilingual('MongoDB ID。', 'MongoDB ID.')),
    id: imageAssetIdSchema,
    shopId: shopIdParamSchema.shape.id
      .optional()
      .describe(bilingual('关联店铺 ID。', 'Associated shop ID.')),
    commentId: z.string().optional().describe(bilingual('关联评论 ID。', 'Associated comment ID.')),
    postId: z.string().optional().describe(bilingual('关联帖子 ID。', 'Associated post ID.')),
    deleteRequestId: z
      .string()
      .optional()
      .describe(bilingual('关联删除申请 ID。', 'Associated delete request ID.')),
    userId: userIdSchema
      .nullable()
      .optional()
      .describe(bilingual('关联用户 ID。', 'Associated user ID.')),
    universityId: z
      .string()
      .nullable()
      .optional()
      .describe(bilingual('关联大学 ID。', 'Associated university ID.')),
    clubId: z
      .string()
      .nullable()
      .optional()
      .describe(bilingual('关联社团 ID。', 'Associated club ID.')),
    url: z.string().describe(bilingual('图片 URL。', 'Image URL.')),
    storageProvider: imageStorageProviderSchema,
    storageKey: z.string().describe(bilingual('存储键。', 'Storage key.')),
    storageObjectId: z
      .string()
      .nullable()
      .optional()
      .describe(bilingual('远端存储对象 ID。', 'Remote storage object ID.')),
    uploadedBy: userIdSchema.nullable().describe(bilingual('上传者用户 ID。', 'Uploader user ID.')),
    uploader: userPublicSchema
      .optional()
      .describe(bilingual('上传者信息。', 'Uploader user summary.')),
    uploadedAt: dateTimeSchema(bilingual('上传时间。', 'Upload time.'))
  })
  .describe(bilingual('图片资源。', 'Image asset.'));

const optionalTrimmedString = (description: string) =>
  z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    })
    .describe(description);

const optionalPositiveIntegerInput = (description: string) =>
  z
    .union([z.string(), z.number(), z.null(), z.undefined()])
    .transform((value) => {
      if (value === null || value === undefined || value === '') return undefined;
      return typeof value === 'number' ? value : Number(value);
    })
    .pipe(z.union([z.number().int().positive(), z.undefined()]))
    .describe(description);

export const imageDraftKindSchema = z
  .enum(['post', 'post-comment', 'shop-comment', 'shop-delete-request', 'delete-request-comment'])
  .describe(bilingual('草稿图片用途。', 'Draft image purpose.'));

export const imageDraftOrganizationTypeSchema = z
  .enum(['university', 'club'])
  .describe(bilingual('草稿所属组织类型。', 'Organization type for a draft image.'));

export const imageUploadFormDataSchema = z
  .object({
    file: z
      .instanceof(File)
      .refine((file) => file.type.startsWith('image/'), 'Only image files are allowed'),
    shopId: optionalPositiveIntegerInput(bilingual('关联店铺 ID。', 'Associated shop ID.')),
    commentId: optionalTrimmedString(bilingual('关联评论 ID。', 'Associated comment ID.')),
    postId: optionalTrimmedString(bilingual('关联帖子 ID。', 'Associated post ID.')),
    deleteRequestId: optionalTrimmedString(
      bilingual('关联删除申请 ID。', 'Associated delete request ID.')
    ),
    draftKind: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((value) => value?.trim() || undefined)
      .pipe(z.union([imageDraftKindSchema, z.undefined()]))
      .describe(bilingual('草稿图片用途。', 'Draft image purpose.')),
    organizationType: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((value) => value?.trim() || undefined)
      .pipe(z.union([imageDraftOrganizationTypeSchema, z.undefined()]))
      .describe(bilingual('草稿所属组织类型。', 'Organization type for a draft image.')),
    organizationId: optionalTrimmedString(
      bilingual('草稿所属组织 ID。', 'Organization ID for a draft image.')
    )
  })
  .superRefine((value, ctx) => {
    const ownerCount = [
      value.shopId,
      value.commentId,
      value.postId,
      value.deleteRequestId
    ].filter((item) => item !== undefined).length;

    if (ownerCount > 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'Images can only belong to one owner at a time',
        path: ['shopId']
      });
    }
  });

export const imageUploadRequestSchema = z.object({
  file: z
    .string()
    .describe(bilingual('要上传的图片文件。', 'Image file to upload.'))
    .meta({ override: { type: 'string', format: 'binary' } }),
  shopId: z
    .int()
    .positive()
    .optional()
    .describe(bilingual('关联店铺 ID。', 'Associated shop ID.')),
  commentId: z.string().optional().describe(bilingual('关联评论 ID。', 'Associated comment ID.')),
  postId: z.string().optional().describe(bilingual('关联帖子 ID。', 'Associated post ID.')),
  deleteRequestId: z
    .string()
    .optional()
    .describe(bilingual('关联删除申请 ID。', 'Associated delete request ID.')),
  draftKind: imageDraftKindSchema.optional(),
  organizationType: imageDraftOrganizationTypeSchema.optional(),
  organizationId: z
    .string()
    .optional()
    .describe(bilingual('草稿所属组织 ID。', 'Organization ID for a draft image.'))
});

export const imageUploadProgressEventSchema = z.object({
  phase: z.literal('uploading').describe(bilingual('上传阶段。', 'Upload phase.')),
  progress: z
    .number()
    .min(0)
    .max(1)
    .describe(
      bilingual(
        '服务端上传到对象存储的进度，范围为 0 到 1。',
        'Server-to-object-storage progress from 0 to 1.'
      )
    )
});

export const imageUploadDoneEventSchema = z.object({
  phase: z.literal('done').describe(bilingual('上传阶段。', 'Upload phase.')),
  imageId: imageAssetIdSchema.describe(bilingual('新图片 ID。', 'New image ID.')),
  url: z.string().describe(bilingual('上传后的图片 URL。', 'Uploaded image URL.')),
  storageProvider: imageStorageProviderSchema,
  storageKey: z.string().describe(bilingual('存储键。', 'Storage key.')),
  storageObjectId: z
    .string()
    .nullable()
    .optional()
    .describe(bilingual('远端存储对象 ID。', 'Remote storage object ID.'))
});

export const imageUploadErrorEventSchema = z.object({
  phase: z.literal('error').describe(bilingual('上传阶段。', 'Upload phase.')),
  message: z.string().describe(bilingual('上传失败信息。', 'Upload failure message.'))
});

export const imageUploadEventSchema = z
  .union([imageUploadProgressEventSchema, imageUploadDoneEventSchema, imageUploadErrorEventSchema])
  .describe(
    bilingual(
      '图片上传事件。响应为 NDJSON，每行一个事件对象。',
      'Image upload event. The response is NDJSON with one event object per line.'
    )
  );

export const imageUploadResponseSchema = imageUploadEventSchema;
