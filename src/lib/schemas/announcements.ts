import { z } from 'zod';
import {
  bilingual,
  dateTimeSchema,
  objectIdSchema,
  positiveIntegerQueryParamSchema,
  successResponseSchema,
  userIdSchema,
  userPublicSchema
} from './common';
import { imageAssetIdSchema, imageAssetSchema } from './images';

export const announcementStatusSchema = z
  .enum(['draft', 'published'])
  .describe(
    bilingual(
      '公告状态：draft 为草稿，published 为已发布。',
      'Announcement status: draft or published.'
    )
  );

export const announcementSchema = z
  .object({
    _id: z.union([z.string(), objectIdSchema]).optional(),
    id: z.string(),
    title: z.string(),
    content: z.string(),
    images: z.array(imageAssetIdSchema).optional(),
    resolvedImages: z.array(imageAssetSchema).optional(),
    createdBy: userIdSchema,
    createdAt: dateTimeSchema(bilingual('创建时间。', 'Creation time.')),
    updatedAt: dateTimeSchema(bilingual('更新时间。', 'Update time.')).optional(),
    status: announcementStatusSchema,
    publishedAt: dateTimeSchema(bilingual('公告发布时间。', 'Announcement publish time.'))
      .nullable()
      .optional(),
    expiresAt: dateTimeSchema(bilingual('公告过期时间。', 'Announcement expiration time.'))
      .nullable()
      .optional(),
    isPinned: z.boolean()
  })
  .describe(bilingual('公告。', 'Announcement.'));

export const announcementWithAuthorSchema = announcementSchema.extend({
  author: userPublicSchema.optional()
});

export const announcementCreateRequestSchema = z
  .object({
    title: z.string().trim().min(1).describe(bilingual('公告标题。', 'Announcement title.')),
    content: z
      .string()
      .trim()
      .optional()
      .default('')
      .describe(bilingual('公告内容（Markdown）。', 'Announcement content in Markdown.')),
    images: z
      .array(imageAssetIdSchema)
      .optional()
      .default([])
      .describe(bilingual('公告图片资源 ID 列表。', 'Announcement image asset IDs.')),
    publish: z
      .boolean()
      .optional()
      .default(true)
      .describe(bilingual('是否立即发布。', 'Whether to publish immediately.')),
    publishAt: dateTimeSchema(bilingual('公告发布时间。', 'Announcement publication time.'))
      .nullable()
      .optional(),
    expiresAt: dateTimeSchema(bilingual('过期时间。', 'Expiration time.')).nullable().optional()
  })
  .refine((value) => value.content.length > 0 || value.images.length > 0, {
    message: 'Announcement content or images are required'
  });

export const announcementCreateResponseSchema = successResponseSchema.extend({
  announcementId: z.string().describe(bilingual('新公告 ID。', 'New announcement ID.'))
});

export const announcementIdParamSchema = z.object({
  announcementId: z.string().trim().min(1)
});

export const announcementListQuerySchema = z.object({
  page: positiveIntegerQueryParamSchema(
    bilingual('页数。默认为 1。', 'Page number. Defaults to 1.'),
    1
  )
});

export const announcementListItemSchema = announcementWithAuthorSchema.extend({
  unread: z
    .boolean()
    .describe(bilingual('当前访问者是否未读。', 'Whether the current viewer has not read it.'))
});

export const announcementListResponseSchema = z.object({
  announcements: z
    .array(announcementListItemSchema)
    .describe(bilingual('公告列表。', 'Announcement list.')),
  hasMore: z
    .boolean()
    .describe(bilingual('是否还有更多公告。', 'Whether more announcements exist.')),
  page: z.int().min(1).describe(bilingual('当前页。', 'Current page.')),
  unreadCount: z.int().min(0).describe(bilingual('未读公告数。', 'Unread announcement count.'))
});

export const announcementReadStateSchema = z.object({
  readThroughAt: z.iso
    .datetime()
    .nullable()
    .describe(
      bilingual(
        '此时间及之前发布的公告视为已读。',
        'Announcements published at or before this time are read.'
      )
    ),
  readTokens: z
    .array(z.string())
    .describe(
      bilingual('单独已读的公告版本标记。', 'Individually read announcement version tokens.')
    )
});

export const announcementReadRequestSchema = z
  .object({
    announcementId: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(bilingual('要标记已读的公告 ID。', 'Announcement ID to mark read.')),
    all: z
      .boolean()
      .optional()
      .describe(
        bilingual(
          '是否将当前全部公告标记为已读。',
          'Whether to mark every current announcement read.'
        )
      )
  })
  .refine((value) => Boolean(value.announcementId || value.all), {
    message: 'A read update is required'
  });

export const announcementReadResponseSchema = successResponseSchema.extend({
  state: announcementReadStateSchema,
  unreadCount: z.int().min(0).describe(bilingual('未读公告数。', 'Unread announcement count.'))
});

export const announcementUpdateRequestSchema = z.object({
  title: z.string().trim().optional(),
  content: z.string().trim().optional(),
  images: z.array(imageAssetIdSchema).optional(),
  status: announcementStatusSchema.optional(),
  publishAt: dateTimeSchema(bilingual('公告发布时间。', 'Announcement publication time.'))
    .nullable()
    .optional(),
  expiresAt: dateTimeSchema(bilingual('公告过期时间。', 'Announcement expiration time.'))
    .nullable()
    .optional(),
  isPinned: z.boolean().optional(),
  notifyReaders: z.boolean().optional()
});

export const announcementUpdateResponseSchema = successResponseSchema;
export const announcementDeleteResponseSchema = successResponseSchema;
