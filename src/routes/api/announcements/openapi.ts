import { bilingual } from '$lib/schemas/common';
import { defineOpenApiRoute, jsonRequestBody, jsonResponse } from '$lib/schemas/openapi';
import {
  announcementCreateRequestSchema,
  announcementCreateResponseSchema,
  announcementListQuerySchema,
  announcementListResponseSchema
} from '$lib/schemas/announcements';

export default defineOpenApiRoute({
  get: {
    tags: ['posts'],
    summary: bilingual('获取公告列表', 'List announcements', true),
    description: bilingual(
      '获取已发布的全站公告，并返回当前访问者的未读数量。',
      'List published site announcements and the current viewer unread count.'
    ),
    requestParams: {
      query: announcementListQuerySchema
    },
    responses: {
      '200': jsonResponse(
        bilingual('公告列表', 'Announcement list', true),
        announcementListResponseSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  },
  post: {
    tags: ['posts'],
    summary: bilingual('创建公告', 'Create announcement', true),
    description: bilingual(
      '站点管理员创建全站公告。公告不支持表态。',
      'Site admins create a site-wide announcement. Announcements do not support user reactions or comments.'
    ),
    requestBody: jsonRequestBody(announcementCreateRequestSchema),
    responses: {
      '201': jsonResponse(
        bilingual('已创建公告', 'Announcement created', true),
        announcementCreateResponseSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '401': { description: bilingual('未授权', 'Unauthorized', true) },
      '403': { description: bilingual('权限不足', 'Forbidden', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});
