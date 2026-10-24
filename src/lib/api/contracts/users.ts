import { z } from 'zod';
import { definePrivate, definePublic } from '../contract';
import { bilingual, fileUploadSchema } from '$lib/schemas/common';
import {
  activityHeatmapQuerySchema,
  activityHeatmapResponseSchema,
  userActivitiesQuerySchema,
  userActivitiesResponseSchema,
  userProfileResponseSchema,
  userRouteIdSchema,
  usersLookupQuerySchema,
  usersLookupResponseSchema
} from '$lib/schemas/users';

export const usersContract = {
  /**
   * `GET /api/users` — look up users by a bound social account.
   *
   * Closed to OAuth clients. Resolving a social account to an account is an
   * administrative lookup, not a delegated one: the handler admits the
   * service secret, a machine secret bound to a shop, and a `site_admin`
   * session, and no third-party client has any business resolving which
   * account a QQ number belongs to.
   *
   * The operation is therefore **private**: it is served, but it is not in the
   * published document, because the only way in is a credential a third party
   * does not have — and the shared secret must never be advertised.
   */
  lookup: definePrivate({
    method: 'GET',
    path: '/users',
    operationId: 'getUsers',
    tags: ['users'],
    guard: 'site_admin_or_secret_or_machine',
    credentials: ['secret', 'machine'],
    summary: bilingual('按社交平台账号查找用户。', 'Look up users by social account.', true),
    description: bilingual(
      '通过已绑定的社交平台账号（如 QQ 号）查找用户。同一账号可能对应多个用户，因此返回匹配列表，由调用方决定取用哪个。仅限管理员、服务密钥与机台密钥调用。',
      'Look up users by a bound social account (e.g. a verified QQ number). A social account may map to several users, so all matches are returned and the caller decides which to use. Administrators, the service key and machine keys only.'
    )
  })
    .input(usersLookupQuerySchema)
    .output(usersLookupResponseSchema),

  /** `GET /api/users/{id}` — the public profile of a single user. */
  profile: definePublic({
    method: 'GET',
    path: '/users/{id}',
    operationId: 'getUsersById',
    tags: ['users'],
    scope: 'open',
    summary: bilingual('获取用户资料。', 'Get a user profile.', true),
    description: bilingual(
      '获取用户公开资料；当当前用户有权限时，也会包含受隐私控制的邮箱、学校和机厅信息。',
      'Get a user profile. When the current viewer has permission, the response also includes privacy-controlled email, university, and arcade information.'
    )
  })
    .input(z.object({ id: userRouteIdSchema }))
    .output(userProfileResponseSchema),

  /** `GET /api/users/{id}/activities` — the activity feed of a single user. */
  activities: definePublic({
    method: 'GET',
    path: '/users/{id}/activities',
    operationId: 'getUsersByIdActivities',
    tags: ['users'],
    scope: 'open',
    summary: bilingual('获取用户活动。', 'Get user activities.', true),
    description: bilingual(
      '获取用户活动流，并根据隐私设置和当前查看者权限过滤不可见内容。支持按日期范围（YYYY-MM-DD，含两端，按指定时区解释）与活动类型过滤。',
      'Get a user activity feed, with entries filtered according to privacy settings and the current viewer permissions. Supports filtering by date range (YYYY-MM-DD, inclusive, interpreted in the given timezone) and by activity types.'
    )
  })
    .input(userActivitiesQuerySchema.extend({ id: userRouteIdSchema }))
    .output(userActivitiesResponseSchema),

  /** `GET /api/users/{id}/activities/heatmap` — per-day activity counts. */
  activityHeatmap: definePublic({
    method: 'GET',
    path: '/users/{id}/activities/heatmap',
    operationId: 'getUsersByIdActivitiesHeatmap',
    tags: ['users'],
    scope: 'open',
    summary: bilingual('获取用户活动热力图。', 'Get user activity heatmap.', true),
    description: bilingual(
      '按天统计用户活动数量（用于个人主页的贡献热力图），遵循与活动流一致的隐私过滤。范围最长 400 天。',
      'Counts user activities per day (for the profile contribution heatmap) with the same privacy filtering as the activity feed. Range is capped at 400 days.'
    )
  })
    .input(activityHeatmapQuerySchema.extend({ id: userRouteIdSchema }))
    .output(activityHeatmapResponseSchema),

  /**
   * `POST /api/users/avatar` — upload the avatar of the signed-in user.
   *
   * The response is an NDJSON event stream (one event object per line), so
   * no output schema is declared — the body is a byte stream, not JSON.
   */
  uploadAvatar: definePublic({
    method: 'POST',
    path: '/users/avatar',
    operationId: 'postUsersAvatar',
    tags: ['users'],
    scope: 'write:account',
    guard: 'session',
    summary: bilingual('上传用户头像。', 'Upload a user avatar.', true),
    description: bilingual(
      '上传当前登录用户的头像，并以 NDJSON 事件流返回上传进度与结果。事件类型为 `uploading`（进度）、`done`（完成）或 `error`（失败）。',
      "Upload the current signed-in user's avatar and receive progress and completion events as an NDJSON stream. Events are `uploading` (progress), `done` (finished) or `error` (failed)."
    )
  }).input(z.object({ file: fileUploadSchema })),

  /** `GET /api/users/me` — the profile of the signed-in user. */
  me: definePublic({
    method: 'GET',
    path: '/users/me',
    operationId: 'getUsersMe',
    tags: ['users'],
    scope: 'read:account',
    guard: 'session',
    summary: bilingual('获取当前用户资料。', 'Get the current user profile.', true),
    description: bilingual(
      '获取当前已登录用户的完整资料。',
      'Get the full profile of the currently authenticated user.'
    )
  })
    .input(z.object({}))
    .output(userProfileResponseSchema)
};
