import { defineOpenApiRoute, jsonRequestBody, jsonResponse } from '$lib/schemas/openapi';
import { bilingual } from '$lib/schemas/common';
import {
  commentIdParamSchema,
  commentVoteRequestSchema,
  commentVoteResponseSchema
} from '$lib/schemas/comments';

export default defineOpenApiRoute({
  post: {
    tags: ['comments'],
    summary: bilingual('对评论投票', 'Vote on a comment', true),
    description: bilingual(
      '对评论投赞成或反对票；重复提交相同投票会撤销该投票。',
      'Cast an upvote or downvote on a comment. Sending the same vote twice removes the existing vote.'
    ),
    requestParams: {
      path: commentIdParamSchema
    },
    requestBody: jsonRequestBody(commentVoteRequestSchema),
    responses: {
      '200': jsonResponse(
        bilingual('评论投票结果', 'Comment vote result', true),
        commentVoteResponseSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '401': { description: bilingual('未授权', 'Unauthorized', true) },
      '403': { description: bilingual('无权限', 'Forbidden', true) },
      '404': {
        description: bilingual('评论或相关对象不存在', 'Comment or related entity not found', true)
      },
      '409': { description: bilingual('目标不可投票', 'Target cannot be voted on', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});
