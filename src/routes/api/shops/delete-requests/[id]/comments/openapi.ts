import { defineOpenApiRoute, jsonRequestBody, jsonResponse } from '$lib/schemas/openapi';
import { bilingual } from '$lib/schemas/common';
import {
  shopDeleteRequestCommentCreateRequestSchema,
  shopDeleteRequestCommentCreateResponseSchema,
  shopDeleteRequestCommentsResponseSchema,
  shopDeleteRequestIdParamSchema
} from '$lib/schemas/shops';

export default defineOpenApiRoute({
  get: {
    tags: ['shops'],
    summary: bilingual('获取删除申请评论', 'Get delete request comments', true),
    description: bilingual(
      '获取删除申请下的评论列表，包含作者信息、当前用户的评论投票，以及评论作者对该删除申请的投票。',
      "Get comments for a delete request, including comment authors, the current user's comment vote, and the delete-request vote cast by each comment author."
    ),
    requestParams: {
      path: shopDeleteRequestIdParamSchema
    },
    responses: {
      '200': jsonResponse(
        bilingual('删除申请评论', 'Delete request comments', true),
        shopDeleteRequestCommentsResponseSchema
      ),
      '404': { description: bilingual('删除申请不存在', 'Delete request not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  },
  post: {
    tags: ['shops'],
    summary: bilingual('发表评论到删除申请', 'Post a comment on a delete request', true),
    description: bilingual(
      '向待处理的删除申请添加评论或回复，可附带图片。',
      'Add a comment or reply to a pending delete request, optionally with images.'
    ),
    requestParams: {
      path: shopDeleteRequestIdParamSchema
    },
    requestBody: jsonRequestBody(shopDeleteRequestCommentCreateRequestSchema),
    responses: {
      '201': jsonResponse(
        bilingual('已创建评论', 'Comment created', true),
        shopDeleteRequestCommentCreateResponseSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '401': { description: bilingual('未授权', 'Unauthorized', true) },
      '404': {
        description: bilingual(
          '删除申请或父评论不存在',
          'Delete request or parent comment not found',
          true
        )
      },
      '409': { description: bilingual('删除申请已关闭', 'Delete request is closed', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});
