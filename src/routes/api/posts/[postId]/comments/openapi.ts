import { bilingual } from '$lib/schemas/common';
import { defineOpenApiRoute, jsonRequestBody, jsonResponse } from '$lib/schemas/openapi';
import {
  postCommentCreateRequestSchema,
  postCommentCreateResponseSchema,
  postIdParamSchema
} from '$lib/schemas/posts';

export default defineOpenApiRoute({
  post: {
    tags: ['posts'],
    summary: bilingual('发表评论到帖子', 'Post a comment', true),
    description: bilingual(
      '向帖子发表评论或回复，可附带图片。',
      'Add a comment or reply to a post, optionally with images.'
    ),
    requestParams: {
      path: postIdParamSchema
    },
    requestBody: jsonRequestBody(postCommentCreateRequestSchema),
    responses: {
      '201': jsonResponse(
        bilingual('已创建评论', 'Comment created', true),
        postCommentCreateResponseSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '401': { description: bilingual('未授权', 'Unauthorized', true) },
      '403': { description: bilingual('权限不足', 'Forbidden', true) },
      '404': {
        description: bilingual('帖子或父评论不存在', 'Post or parent comment not found', true)
      },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});
