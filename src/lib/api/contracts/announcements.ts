import { definePublic } from '../contract';
import { bilingual } from '$lib/schemas/common';
import {
  announcementCreateRequestSchema,
  announcementCreateResponseSchema,
  announcementDeleteResponseSchema,
  announcementIdParamSchema,
  announcementListQuerySchema,
  announcementListResponseSchema,
  announcementReadRequestSchema,
  announcementReadResponseSchema,
  announcementUpdateRequestSchema,
  announcementUpdateResponseSchema
} from '$lib/schemas/announcements';

/** The announcement id as it travels in the path. */
const announcementIdSchema = announcementIdParamSchema.shape.announcementId;

export const announcementsContract = {
  /** `GET /api/announcements` — the published announcements and the viewer's unread count. */
  list: definePublic({
    method: 'GET',
    path: '/announcements',
    operationId: 'getAnnouncements',
    tags: ['posts'],
    scope: 'open',
    summary: bilingual('获取公告列表。', 'List announcements.', true),
    description: bilingual(
      '获取已发布的全站公告，并返回当前访问者的未读数量。',
      'List published site announcements and the current viewer unread count.'
    )
  })
    .input(announcementListQuerySchema)
    .output(announcementListResponseSchema),

  /** `POST /api/announcements` — a site admin publishes a site-wide announcement. */
  create: definePublic({
    method: 'POST',
    path: '/announcements',
    operationId: 'postAnnouncements',
    tags: ['posts'],
    scope: null,
    guard: 'site_admin',
    successStatus: 201,
    summary: bilingual('创建公告。', 'Create announcement.', true),
    description: bilingual(
      '站点管理员创建全站公告。公告不支持表态。',
      'Site admins create a site-wide announcement. Announcements do not support user reactions or comments.'
    )
  })
    .input(announcementCreateRequestSchema)
    .output(announcementCreateResponseSchema),

  /** `PUT /api/announcements/{announcementId}` — update an announcement. */
  update: definePublic({
    method: 'PUT',
    path: '/announcements/{announcementId}',
    operationId: 'updateAnnouncement',
    tags: ['posts'],
    scope: null,
    guard: 'site_admin',
    summary: bilingual('更新公告。', 'Update announcement.', true),
    description: bilingual(
      '更新公告的标题、内容、图片、发布状态与过期时间。',
      'Update the title, content, images, publication state and expiry date of an announcement.'
    )
  })
    .input(announcementUpdateRequestSchema.extend({ announcementId: announcementIdSchema }))
    .output(announcementUpdateResponseSchema),

  /** `DELETE /api/announcements/{announcementId}` — delete an announcement. */
  remove: definePublic({
    method: 'DELETE',
    path: '/announcements/{announcementId}',
    operationId: 'deleteAnnouncement',
    tags: ['posts'],
    scope: null,
    guard: 'site_admin',
    summary: bilingual('删除公告。', 'Delete announcement.', true),
    description: bilingual(
      '删除公告及其关联图片。',
      'Delete an announcement and its attached images.'
    )
  })
    .input(announcementIdParamSchema)
    .output(announcementDeleteResponseSchema),

  /** `POST /api/announcements/read` — move the read cursor forward. */
  markRead: definePublic({
    method: 'POST',
    path: '/announcements/read',
    operationId: 'postAnnouncementsRead',
    tags: ['posts'],
    scope: 'open',
    summary: bilingual('更新公告已读状态。', 'Update announcement read state.', true),
    description: bilingual(
      '为登录用户持久化已读水位，或为访客写入仅包含已读水位的 Cookie。',
      'Persists a read cursor for signed-in users, or stores a read-cursor cookie for guests.'
    )
  })
    .input(announcementReadRequestSchema)
    .output(announcementReadResponseSchema)
};
