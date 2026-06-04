import { bilingual } from '$lib/schemas/common';
import { defineOpenApiRoute, jsonRequestBody, jsonResponse } from '$lib/schemas/openapi';
import {
  organizationPostsQuerySchema,
  organizationPostsResponseSchema,
  postCreateRequestSchema,
  postCreateResponseSchema
} from '$lib/schemas/posts';
import { universityIdParamSchema } from '$lib/schemas/organizations';

export default defineOpenApiRoute({
  get: {
    tags: ['universities'],
    summary: bilingual('获取大学帖子', 'Get university posts', true),
    description: bilingual(
      '获取大学帖子列表，并按帖子可见性过滤当前用户不可见的帖子。',
      'Get university posts and filter out posts the current user cannot read.'
    ),
    requestParams: {
      path: universityIdParamSchema,
      query: organizationPostsQuerySchema
    },
    responses: {
      '200': jsonResponse(
        bilingual('大学帖子列表', 'University post list', true),
        organizationPostsResponseSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '404': { description: bilingual('大学不存在', 'University not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  },
  post: {
    tags: ['universities'],
    summary: bilingual('创建大学帖子', 'Create university post', true),
    description: bilingual(
      '在大学下创建帖子，可附带图片并指定帖子可见性。',
      'Create a post under a university, optionally with images and an explicit readability setting.'
    ),
    requestParams: {
      path: universityIdParamSchema
    },
    requestBody: jsonRequestBody(postCreateRequestSchema),
    responses: {
      '201': jsonResponse(bilingual('已创建帖子', 'Post created', true), postCreateResponseSchema),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '401': { description: bilingual('未授权', 'Unauthorized', true) },
      '403': { description: bilingual('权限不足', 'Forbidden', true) },
      '404': { description: bilingual('大学不存在', 'University not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});
