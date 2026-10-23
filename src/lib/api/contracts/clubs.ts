import { z } from 'zod';
import { definePublic } from '../contract';
import { bilingual, fileUploadSchema } from '$lib/schemas/common';
import {
  clubArcadesQuerySchema,
  clubArcadesResponseSchema,
  clubDetailResponseSchema,
  clubIdParamSchema,
  clubMembersQuerySchema,
  clubMembersResponseSchema,
  clubRouteIdSchema,
  clubsListQuerySchema,
  clubsListResponseSchema
} from '$lib/schemas/organizations';
import {
  organizationPostsQuerySchema,
  organizationPostsResponseSchema,
  postCreateRequestSchema,
  postCreateResponseSchema
} from '$lib/schemas/posts';

export const clubsContract = {
  /** `GET /api/clubs` — clubs filtered by keyword and university. */
  list: definePublic({
    method: 'GET',
    path: '/clubs',
    operationId: 'getClubs',
    tags: ['clubs'],
    scope: 'open',
    summary: bilingual('获取社团列表', 'Get clubs', true),
    description: bilingual(
      '按关键词和大学筛选社团列表，并返回大学筛选项。',
      'Get clubs filtered by search query and university, along with university filter options.'
    )
  })
    .input(clubsListQuerySchema)
    .output(clubsListResponseSchema),

  /** `GET /api/clubs/{id}` — one club, addressed by ID or slug. */
  detail: definePublic({
    method: 'GET',
    path: '/clubs/{id}',
    operationId: 'getClubsById',
    tags: ['clubs'],
    scope: 'open',
    summary: bilingual('获取社团详情', 'Get club details', true),
    description: bilingual(
      '获取社团详情、成员摘要、收藏店铺以及当前用户权限。',
      'Get club details, member summaries, starred arcades, and the current user permissions.'
    )
  })
    .input(clubIdParamSchema)
    .output(clubDetailResponseSchema),

  /** `GET /api/clubs/{id}/arcades` — the starred arcades of one club. */
  arcades: definePublic({
    method: 'GET',
    path: '/clubs/{id}/arcades',
    operationId: 'getClubsByIdArcades',
    tags: ['clubs'],
    scope: 'open',
    summary: bilingual('获取社团收藏店铺', 'Get club arcades', true),
    description: bilingual(
      '分页获取社团收藏的店铺列表。',
      'Get a paginated list of the arcades starred by a club.'
    )
  })
    .input(clubIdParamSchema.merge(clubArcadesQuerySchema))
    .output(clubArcadesResponseSchema),

  /**
   * `POST /api/clubs/{id}/avatar` — avatar upload.
   *
   * The response is an NDJSON event stream, not a JSON document, so no output
   * schema is declared: the stream is described in the description instead.
   */
  uploadAvatar: definePublic({
    method: 'POST',
    path: '/clubs/{id}/avatar',
    operationId: 'postClubsByIdAvatar',
    tags: ['clubs'],
    scope: 'write:clubs',
    guard: 'session',
    summary: bilingual('上传社团头像', 'Upload club avatar', true),
    description: bilingual(
      '上传社团头像，并以 NDJSON 事件流返回上传进度与结果。',
      'Upload a club avatar and receive progress and completion events as an NDJSON stream.'
    )
  }).input(
    z.object({
      id: clubRouteIdSchema,
      file: fileUploadSchema
    })
  ),

  /** `GET /api/clubs/{id}/members` — the members of one club. */
  members: definePublic({
    method: 'GET',
    path: '/clubs/{id}/members',
    operationId: 'getClubsByIdMembers',
    tags: ['clubs'],
    scope: 'open',
    summary: bilingual('获取社团成员', 'Get club members', true),
    description: bilingual(
      '分页获取社团成员列表。未公开大学信息的用户会根据查看者权限被过滤。',
      'Get a paginated list of club members. Users with private university visibility are filtered based on viewer permissions.'
    )
  })
    .input(clubIdParamSchema.merge(clubMembersQuerySchema))
    .output(clubMembersResponseSchema),

  /** `GET /api/clubs/{id}/posts` — the posts of one club. */
  posts: definePublic({
    method: 'GET',
    path: '/clubs/{id}/posts',
    operationId: 'getClubsByIdPosts',
    tags: ['clubs'],
    scope: 'open',
    summary: bilingual('获取社团帖子', 'Get club posts', true),
    description: bilingual(
      '获取社团帖子列表，并按帖子可见性过滤当前用户不可见的帖子。',
      'Get club posts and filter out posts the current user cannot read.'
    )
  })
    .input(clubIdParamSchema.merge(organizationPostsQuerySchema))
    .output(organizationPostsResponseSchema),

  /** `POST /api/clubs/{id}/posts` — create a post under a club. */
  createPost: definePublic({
    method: 'POST',
    path: '/clubs/{id}/posts',
    operationId: 'postClubsByIdPosts',
    tags: ['clubs'],
    scope: 'write:posts',
    guard: 'session',
    successStatus: 201,
    summary: bilingual('创建社团帖子', 'Create club post', true),
    description: bilingual(
      '在社团下创建帖子，可附带图片并指定帖子可见性。',
      'Create a post under a club, optionally with images and an explicit readability setting.'
    )
  })
    .input(postCreateRequestSchema.safeExtend({ id: clubRouteIdSchema }))
    .output(postCreateResponseSchema)
};
