import { defineOpenApiRoute, jsonRequestBody, successJsonResponse } from '$lib/schemas/openapi';
import { bilingual } from '$lib/schemas/common';
import { commentIdParamSchema, commentUpdateRequestSchema } from '$lib/schemas/comments';

export default defineOpenApiRoute({
  put: {
    tags: ['comments'],
    summary: bilingual('更新评论', 'Update a comment', true),
    description: bilingual(
      '更新当前用户自己的评论内容和附图。',
      'Update the current user’s own comment content and attached images.'
    ),
    requestParams: {
      path: commentIdParamSchema
    },
    requestBody: jsonRequestBody(commentUpdateRequestSchema),
    responses: {
      '200': successJsonResponse(),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '401': { description: bilingual('未授权', 'Unauthorized', true) },
      '403': { description: bilingual('无权限', 'Forbidden', true) },
      '404': { description: bilingual('评论不存在', 'Comment not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  },
  delete: {
    tags: ['comments'],
    summary: bilingual('删除评论', 'Delete a comment', true),
    description: bilingual(
      '删除指定评论及其直接回复，并清理关联图片与投票。',
      'Delete a comment together with its direct replies, and clean up related images and votes.'
    ),
    requestParams: {
      path: commentIdParamSchema
    },
    responses: {
      '200': successJsonResponse(),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '401': { description: bilingual('未授权', 'Unauthorized', true) },
      '403': { description: bilingual('无权限', 'Forbidden', true) },
      '404': { description: bilingual('评论或帖子不存在', 'Comment or post not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});
