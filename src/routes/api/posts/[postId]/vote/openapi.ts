import { bilingual } from '$lib/schemas/common';
import { defineOpenApiRoute, jsonRequestBody, jsonResponse } from '$lib/schemas/openapi';
import {
  postIdParamSchema,
  postVoteRequestSchema,
  postVoteResponseSchema
} from '$lib/schemas/posts';

export default defineOpenApiRoute({
  post: {
    tags: ['posts'],
    summary: bilingual('为帖子投票', 'Vote on a post', true),
    description: bilingual(
      '对帖子点赞或点踩；重复提交相同投票会撤销该投票。',
      'Upvote or downvote a post. Sending the same vote twice removes the existing vote.'
    ),
    requestParams: {
      path: postIdParamSchema
    },
    requestBody: jsonRequestBody(postVoteRequestSchema),
    responses: {
      '200': jsonResponse(bilingual('投票结果', 'Vote result', true), postVoteResponseSchema),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '401': { description: bilingual('未授权', 'Unauthorized', true) },
      '403': { description: bilingual('权限不足', 'Forbidden', true) },
      '404': { description: bilingual('帖子不存在', 'Post not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});
