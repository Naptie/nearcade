import { bilingual } from '$lib/schemas/common';
import { defineOpenApiRoute, jsonRequestBody, jsonResponse } from '$lib/schemas/openapi';
import {
  postDeleteResponseSchema,
  postDetailResponseSchema,
  postIdParamSchema,
  postUpdateRequestSchema,
  postUpdateResponseSchema
} from '$lib/schemas/posts';

export default defineOpenApiRoute({
  get: {
    tags: ['posts'],
    summary: bilingual('获取帖子详情', 'Get post details', true),
    description: bilingual(
      '获取帖子详情、评论列表，以及当前用户对帖子的投票状态。',
      'Get a post with its comments and the current user vote on the post.'
    ),
    requestParams: {
      path: postIdParamSchema
    },
    responses: {
      '200': jsonResponse(bilingual('帖子详情', 'Post details', true), postDetailResponseSchema),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '403': { description: bilingual('无权查看该帖子', 'Forbidden', true) },
      '404': { description: bilingual('帖子不存在', 'Post not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  },
  put: {
    tags: ['posts'],
    summary: bilingual('更新帖子', 'Update post', true),
    description: bilingual(
      '更新帖子内容、图片、可见性，或管理置顶与锁定状态。',
      'Update post content, images, readability, or manage pin and lock state.'
    ),
    requestParams: {
      path: postIdParamSchema
    },
    requestBody: jsonRequestBody(postUpdateRequestSchema),
    responses: {
      '200': jsonResponse(bilingual('更新结果', 'Update result', true), postUpdateResponseSchema),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '401': { description: bilingual('未授权', 'Unauthorized', true) },
      '403': { description: bilingual('权限不足', 'Forbidden', true) },
      '404': { description: bilingual('帖子不存在', 'Post not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  },
  delete: {
    tags: ['posts'],
    summary: bilingual('删除帖子', 'Delete post', true),
    description: bilingual(
      '删除帖子及其关联评论与投票。',
      'Delete a post and its related comments and votes.'
    ),
    requestParams: {
      path: postIdParamSchema
    },
    responses: {
      '200': jsonResponse(bilingual('删除结果', 'Delete result', true), postDeleteResponseSchema),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '401': { description: bilingual('未授权', 'Unauthorized', true) },
      '403': { description: bilingual('权限不足', 'Forbidden', true) },
      '404': { description: bilingual('帖子不存在', 'Post not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});
