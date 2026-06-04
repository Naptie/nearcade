import { defineOpenApiRoute, jsonRequestBody, jsonResponse } from '$lib/schemas/openapi';
import { bilingual } from '$lib/schemas/common';
import {
  shopCommentCreateRequestSchema,
  shopCommentCreateResponseSchema,
  shopCommentsResponseSchema,
  shopIdParamSchema
} from '$lib/schemas/shops';

export default defineOpenApiRoute({
  get: {
    tags: ['shops'],
    summary: bilingual('获取店铺评论', 'Get shop comments', true),
    description: bilingual(
      '获取店铺评论列表，包含作者信息、当前用户对评论的投票，以及已解析的评论图片。',
      "Get comments for a shop, including comment authors, the current user's vote on each comment, and resolved comment images."
    ),
    requestParams: {
      path: shopIdParamSchema
    },
    responses: {
      '200': jsonResponse(bilingual('店铺评论', 'Shop comments', true), shopCommentsResponseSchema),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  },
  post: {
    tags: ['shops'],
    summary: bilingual('发表评论到店铺', 'Post a shop comment', true),
    description: bilingual(
      '向店铺发表评论或回复，可附带图片。',
      'Add a comment or reply to a shop, optionally with images.'
    ),
    requestParams: {
      path: shopIdParamSchema
    },
    requestBody: jsonRequestBody(shopCommentCreateRequestSchema),
    responses: {
      '201': jsonResponse(
        bilingual('已创建评论', 'Comment created', true),
        shopCommentCreateResponseSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '401': { description: bilingual('未授权', 'Unauthorized', true) },
      '404': {
        description: bilingual('店铺或父评论不存在', 'Shop or parent comment not found', true)
      },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});
