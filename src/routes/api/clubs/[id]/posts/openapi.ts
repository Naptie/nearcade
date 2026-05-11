import { bilingual } from '$lib/schemas/common';
import { defineOpenApiRoute, jsonRequestBody, jsonResponse } from '$lib/schemas/openapi';
import {
  organizationPostsQuerySchema,
  organizationPostsResponseSchema,
  postCreateRequestSchema,
  postCreateResponseSchema
} from '$lib/schemas/posts';
import { clubIdParamSchema } from '$lib/schemas/organizations';

export default defineOpenApiRoute({
  get: {
    tags: ['clubs'],
    summary: bilingual('获取社团帖子', 'Get club posts', true),
    description: bilingual(
      '获取社团帖子列表，并按帖子可见性过滤当前用户不可见的帖子。',
      'Get club posts and filter out posts the current user cannot read.'
    ),
    requestParams: {
      path: clubIdParamSchema,
      query: organizationPostsQuerySchema
    },
    responses: {
      '200': jsonResponse(
        bilingual('社团帖子列表', 'Club post list', true),
        organizationPostsResponseSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '404': { description: bilingual('社团不存在', 'Club not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  },
  post: {
    tags: ['clubs'],
    summary: bilingual('创建社团帖子', 'Create club post', true),
    description: bilingual(
      '在社团下创建帖子，可附带图片并指定帖子可见性。',
      'Create a post under a club, optionally with images and an explicit readability setting.'
    ),
    requestParams: {
      path: clubIdParamSchema
    },
    requestBody: jsonRequestBody(postCreateRequestSchema),
    responses: {
      '201': jsonResponse(bilingual('已创建帖子', 'Post created', true), postCreateResponseSchema),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '401': { description: bilingual('未授权', 'Unauthorized', true) },
      '403': { description: bilingual('权限不足', 'Forbidden', true) },
      '404': { description: bilingual('社团不存在', 'Club not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});
