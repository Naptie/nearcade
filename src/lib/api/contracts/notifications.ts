import { z } from 'zod';
import { definePrivate, definePublic } from '../contract';
import {
  NOTIFICATION_TYPES,
  bilingual,
  mongoIdSchema,
  successResponseSchema
} from '$lib/schemas/common';
import { UGC_CONTENT_TYPES, UGC_KINDS } from '$lib/ugc/types';
import { PAGINATION } from '$lib/constants';

const notificationTypeSchema = z
  .enum(NOTIFICATION_TYPES)
  .describe(bilingual('通知类型。', 'Notification type.'));

/**
 * A stored notification.
 *
 * The legacy handler returned the raw MongoDB documents, so the object stays
 * loose: fields the schema does not know about are passed through unchanged.
 */
const notificationSchema = z.looseObject({
  _id: mongoIdSchema,
  id: z.string().describe(bilingual('通知 ID。', 'Notification ID.')),
  type: notificationTypeSchema,
  actorUserId: z.string().describe(bilingual('触发者用户 ID。', 'Actor user ID.')),
  actorName: z.string().describe(bilingual('触发者用户名。', 'Actor username.')),
  actorDisplayName: z
    .string()
    .optional()
    .describe(bilingual('触发者显示名称。', 'Actor display name.')),
  actorImage: z.string().optional().describe(bilingual('触发者头像。', 'Actor avatar.')),
  targetUserId: z.string().describe(bilingual('接收者用户 ID。', 'Recipient user ID.')),
  createdAt: z.date().describe(bilingual('通知时间。', 'Notification time.')),
  readAt: z
    .union([z.date(), z.null()])
    .optional()
    .describe(bilingual('已读时间；null 表示未读。', 'Read time; null means unread.')),
  content: z.string().optional().describe(bilingual('通知内容。', 'Notification content.')),
  postId: z.string().optional().describe(bilingual('关联帖子 ID。', 'Associated post ID.')),
  postTitle: z.string().optional().describe(bilingual('关联帖子标题。', 'Associated post title.')),
  commentId: z.string().optional().describe(bilingual('关联评论 ID。', 'Associated comment ID.')),
  voteType: z
    .enum(['upvote', 'downvote'])
    .optional()
    .describe(bilingual('投票类型。', 'Vote type.')),
  shopId: z.number().optional().describe(bilingual('关联店铺 ID。', 'Associated shop ID.')),
  joinRequestId: z
    .string()
    .optional()
    .describe(bilingual('关联入队申请 ID。', 'Associated join request ID.')),
  joinRequestStatus: z
    .enum(['approved', 'rejected'])
    .optional()
    .describe(bilingual('入队申请状态。', 'Join request status.')),
  joinRequestType: z
    .enum(['university', 'club'])
    .optional()
    .describe(bilingual('入队申请类型。', 'Join request type.')),
  shopDeleteRequestId: z
    .string()
    .optional()
    .describe(bilingual('关联删除申请 ID。', 'Associated delete request ID.')),
  shopDeleteRequestStatus: z
    .enum(['approved', 'rejected', 'deleted'])
    .optional()
    .describe(bilingual('删除申请状态。', 'Delete request status.')),
  shopDeleteRequestType: z
    .enum(['shop', 'photo'])
    .optional()
    .describe(bilingual('删除申请类型。', 'Delete request type.')),
  shopName: z.string().optional().describe(bilingual('店铺名称。', 'Shop name.')),
  kind: z
    .enum(UGC_KINDS)
    .optional()
    .describe(bilingual('内容所属实体族。', 'Entity family of the content.')),
  noticeKind: z
    .literal('rollback')
    .optional()
    .describe(bilingual('系统通知子类型。', 'System notice sub-kind.')),
  contentType: z
    .enum(UGC_CONTENT_TYPES)
    .optional()
    .describe(bilingual('被审核的内容类型。', 'Audited content type.')),
  refId: z.string().optional().describe(bilingual('关联实体 ID。', 'Referenced entity ID.')),
  reason: z.string().optional().describe(bilingual('原因说明。', 'Reason.')),
  reviewedBy: z.string().optional().describe(bilingual('审核人用户 ID。', 'Reviewer user ID.')),
  universityId: z.string().optional().describe(bilingual('大学 ID。', 'University ID.')),
  clubId: z.string().optional().describe(bilingual('社团 ID。', 'Club ID.')),
  universityName: z.string().optional().describe(bilingual('大学名称。', 'University name.')),
  clubName: z.string().optional().describe(bilingual('社团名称。', 'Club name.'))
});

/** The response of `GET /api/notifications`. */
export const notificationListResponseSchema = z.object({
  notifications: z
    .array(notificationSchema)
    .describe(bilingual('通知列表。', 'Notification list.')),
  hasMore: z
    .boolean()
    .describe(bilingual('是否还有更多通知。', 'Whether more notifications exist.')),
  page: z.number().describe(bilingual('当前页。', 'Current page.')),
  limit: z.number().describe(bilingual('每页条目数。', 'Items per page.'))
});

/** The batch result FCM reports back after a multicast send. */
export const fcmSendResponseSchema = z.looseObject({
  successCount: z.number().describe(bilingual('推送成功的设备数。', 'Number of devices reached.')),
  failureCount: z
    .number()
    .describe(bilingual('推送失败的设备数。', 'Number of devices that failed.')),
  responses: z
    .array(z.unknown())
    .describe(bilingual('每台设备的推送结果。', 'Per-device delivery result.'))
});

/** The result of storing or removing an FCM device token. */
export const fcmTokenResponseSchema = z.object({
  success: z.boolean().describe(bilingual('是否成功。', 'Whether the operation succeeded.')),
  message: z.string().describe(bilingual('结果说明。', 'Result message.'))
});

export const notificationsContract = {
  /** `GET /api/notifications` — the signed-in user's notification feed. */
  list: definePublic({
    method: 'GET',
    path: '/notifications',
    operationId: 'listNotifications',
    tags: ['notifications'],
    scope: 'read:notifications',
    guard: 'session',
    summary: bilingual('获取通知列表。', 'List notifications.', true),
    description: bilingual(
      '按创建时间倒序返回当前用户的通知，可按页码分页或只读取未读通知。',
      "Returns the current user's notifications, newest first, with optional pagination and an unread-only filter."
    )
  })
    .input(
      z.object({
        page: z.coerce
          .number()
          .int()
          .min(1)
          .optional()
          .default(1)
          .describe(bilingual('页数。默认为 1。', 'Page number. Defaults to 1.')),
        limit: z.coerce
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .default(PAGINATION.PAGE_SIZE)
          .describe(
            bilingual(
              '每页返回的通知数量。默认为站点分页大小，最大为 100。',
              'Number of notifications per page. Defaults to the site page size, up to 100.'
            )
          ),
        unreadOnly: z
          .string()
          .optional()
          .transform((value) => value === 'true')
          .describe(
            bilingual('是否只返回未读通知。', 'Whether to only return unread notifications.')
          )
      })
    )
    .output(notificationListResponseSchema),

  /** `POST /api/notifications` — mark the signed-in user's notifications as read. */
  markRead: definePublic({
    method: 'POST',
    path: '/notifications',
    operationId: 'markNotificationsRead',
    tags: ['notifications'],
    scope: 'write:notifications',
    guard: 'session',
    summary: bilingual('标记通知为已读。', 'Mark notifications as read.', true),
    description: bilingual(
      '将当前用户的未读通知全部标记为已读。',
      'Mark every unread notification of the current user as read.'
    )
  })
    .input(
      z.object({
        action: z
          .string()
          .describe(
            bilingual(
              '操作名称，当前仅支持 `markAsRead`。',
              'Action name; only `markAsRead` is supported.'
            )
          )
      })
    )
    .output(successResponseSchema),

  /** `POST /api/notifications/fcm/send` — push a notification through FCM. */
  sendFcm: definePrivate({
    method: 'POST',
    path: '/notifications/fcm/send',
    operationId: 'sendFcmNotification',
    tags: ['notifications'],
    guard: 'secret',
    credentials: ['secret'],
    summary: bilingual('发送 FCM 推送通知。', 'Send an FCM push notification.', true),
    description: bilingual(
      '通过 Firebase Cloud Messaging 向指定用户推送一条通知。调用方需携带 `SSC_SECRET` 服务密钥，而不是用户会话。',
      'Push a notification to a user through Firebase Cloud Messaging. The caller presents the `SSC_SECRET` service key, not a user session.'
    )
  })
    .input(
      z.looseObject({
        type: notificationTypeSchema,
        actorUserId: z.string().describe(bilingual('触发者用户 ID。', 'Actor user ID.')),
        actorName: z.string().describe(bilingual('触发者用户名。', 'Actor username.')),
        actorDisplayName: z
          .string()
          .optional()
          .describe(bilingual('触发者显示名称。', 'Actor display name.')),
        actorImage: z.string().optional().describe(bilingual('触发者头像。', 'Actor avatar.')),
        targetUserId: z.string().describe(bilingual('接收者用户 ID。', 'Recipient user ID.')),
        content: z.string().optional().describe(bilingual('通知内容。', 'Notification content.'))
      })
    )
    .output(fcmSendResponseSchema),

  /** `POST /api/notifications/fcm/token` — store or remove the caller's FCM token. */
  fcmToken: definePublic({
    method: 'POST',
    path: '/notifications/fcm/token',
    operationId: 'manageFcmToken',
    tags: ['notifications'],
    scope: 'write:notifications',
    guard: 'session',
    summary: bilingual('管理 FCM 设备令牌。', 'Manage the FCM device token.', true),
    description: bilingual(
      '登记或移除当前用户的 FCM 设备令牌。',
      "Register or remove the current user's FCM device token."
    )
  })
    .input(
      z.object({
        token: z.string().optional().describe(bilingual('FCM 设备令牌。', 'FCM device token.')),
        action: z
          .string()
          .optional()
          .describe(
            bilingual('操作名称：`store` 或 `remove`。', 'Action name: `store` or `remove`.')
          )
      })
    )
    .output(fcmTokenResponseSchema)
};
