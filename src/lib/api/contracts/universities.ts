import { z } from 'zod';
import { definePublic } from '../contract';
import { bilingual, fileUploadSchema } from '$lib/schemas/common';
import {
  universityChangelogQuerySchema,
  universityChangelogResponseSchema,
  universityClubListResponseSchema,
  universityClubsQuerySchema,
  universityDetailResponseSchema,
  universityIdParamSchema,
  universityMembersQuerySchema,
  universityMembersResponseSchema,
  universityRouteIdSchema,
  universitiesSearchQuerySchema,
  universitiesSearchResponseSchema
} from '$lib/schemas/organizations';
import {
  organizationPostsQuerySchema,
  organizationPostsResponseSchema,
  postCreateRequestSchema,
  postCreateResponseSchema
} from '$lib/schemas/posts';

export const universitiesContract = {
  /** `GET /api/universities` — keyword search over the universities. */
  search: definePublic({
    method: 'GET',
    path: '/universities',
    operationId: 'getUniversities',
    tags: ['universities'],
    scope: 'open',
    summary: bilingual('搜索大学', 'Search universities', true),
    description: bilingual(
      '按关键词搜索大学；当查询为空时返回空列表。',
      'Search universities by keyword. Returns an empty list when the query is blank.'
    )
  })
    .input(universitiesSearchQuerySchema)
    .output(universitiesSearchResponseSchema),

  /** `GET /api/universities/{id}` — one university, addressed by ID or slug. */
  detail: definePublic({
    method: 'GET',
    path: '/universities/{id}',
    operationId: 'getUniversitiesById',
    tags: ['universities'],
    scope: 'open',
    summary: bilingual('获取大学详情', 'Get university details', true),
    description: bilingual('按 ID 或 slug 获取大学详情。', 'Get university details by ID or slug.')
  })
    .input(universityIdParamSchema)
    .output(universityDetailResponseSchema),

  /**
   * `POST /api/universities/{id}/avatar` — avatar upload.
   *
   * The response is an NDJSON event stream, not a JSON document, so no output
   * schema is declared: the stream is described in the description instead.
   */
  uploadAvatar: definePublic({
    method: 'POST',
    path: '/universities/{id}/avatar',
    operationId: 'postUniversitiesByIdAvatar',
    tags: ['universities'],
    scope: 'write:universities',
    guard: 'session',
    summary: bilingual('上传大学头像', 'Upload university avatar', true),
    description: bilingual(
      '上传大学头像，并以 NDJSON 事件流返回上传进度与结果。',
      'Upload a university avatar and receive progress and completion events as an NDJSON stream.'
    )
  }).input(
    z.object({
      id: universityRouteIdSchema,
      file: fileUploadSchema
    })
  ),

  /** `GET /api/universities/{id}/changelog` — paginated change log. */
  changelog: definePublic({
    method: 'GET',
    path: '/universities/{id}/changelog',
    operationId: 'getUniversitiesByIdChangelog',
    tags: ['universities'],
    scope: 'open',
    summary: bilingual('获取大学变更记录', 'Get university changelog', true),
    description: bilingual(
      '分页获取大学的变更记录。',
      'Get paginated changelog entries for a university.'
    )
  })
    .input(universityIdParamSchema.merge(universityChangelogQuerySchema))
    .output(universityChangelogResponseSchema),

  /** `GET /api/universities/{id}/clubs` — the clubs of one university. */
  clubs: definePublic({
    method: 'GET',
    path: '/universities/{id}/clubs',
    operationId: 'getUniversitiesByIdClubs',
    tags: ['universities'],
    scope: 'open',
    summary: bilingual('获取大学社团', 'Get university clubs', true),
    description: bilingual(
      '分页获取属于指定大学的社团列表。',
      'Get a paginated list of clubs belonging to a university.'
    )
  })
    .input(universityIdParamSchema.merge(universityClubsQuerySchema))
    .output(universityClubListResponseSchema),

  /** `GET /api/universities/{id}/members` — the members of one university. */
  members: definePublic({
    method: 'GET',
    path: '/universities/{id}/members',
    operationId: 'getUniversitiesByIdMembers',
    tags: ['universities'],
    scope: 'open',
    summary: bilingual('获取大学成员', 'Get university members', true),
    description: bilingual(
      '分页获取大学成员列表。未公开大学信息的用户会根据查看者权限被过滤。',
      'Get a paginated list of university members. Users with private university visibility are filtered based on viewer permissions.'
    )
  })
    .input(universityIdParamSchema.merge(universityMembersQuerySchema))
    .output(universityMembersResponseSchema),

  /** `GET /api/universities/{id}/posts` — the posts of one university. */
  posts: definePublic({
    method: 'GET',
    path: '/universities/{id}/posts',
    operationId: 'getUniversitiesByIdPosts',
    tags: ['universities'],
    scope: 'open',
    summary: bilingual('获取大学帖子', 'Get university posts', true),
    description: bilingual(
      '获取大学帖子列表，并按帖子可见性过滤当前用户不可见的帖子。',
      'Get university posts and filter out posts the current user cannot read.'
    )
  })
    .input(universityIdParamSchema.merge(organizationPostsQuerySchema))
    .output(organizationPostsResponseSchema),

  /** `POST /api/universities/{id}/posts` — create a post under a university. */
  createPost: definePublic({
    method: 'POST',
    path: '/universities/{id}/posts',
    operationId: 'postUniversitiesByIdPosts',
    tags: ['universities'],
    scope: 'write:posts',
    guard: 'session',
    successStatus: 201,
    summary: bilingual('创建大学帖子', 'Create university post', true),
    description: bilingual(
      '在大学下创建帖子，可附带图片并指定帖子可见性。',
      'Create a post under a university, optionally with images and an explicit readability setting.'
    )
  })
    .input(postCreateRequestSchema.safeExtend({ id: universityRouteIdSchema }))
    .output(postCreateResponseSchema)
};
