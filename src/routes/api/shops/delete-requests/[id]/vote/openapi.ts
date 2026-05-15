import { defineOpenApiRoute, jsonRequestBody, jsonResponse } from '$lib/schemas/openapi';
import { bilingual } from '$lib/schemas/common';
import {
  shopDeleteRequestIdParamSchema,
  shopDeleteRequestVoteRequestSchema,
  shopDeleteRequestVoteResponseSchema
} from '$lib/schemas/shops';

export default defineOpenApiRoute({
  post: {
    tags: ['shops'],
    summary: bilingual('对删除申请投票', 'Vote on a delete request', true),
    description: bilingual(
      '对待处理的删除申请投支持或反对票。重复提交相同投票会撤销该投票。',
      'Cast a supporting or opposing vote on a pending delete request. Sending the same vote twice removes the existing vote.'
    ),
    requestParams: {
      path: shopDeleteRequestIdParamSchema
    },
    requestBody: jsonRequestBody(shopDeleteRequestVoteRequestSchema),
    responses: {
      '200': jsonResponse(
        bilingual('投票结果', 'Vote result', true),
        shopDeleteRequestVoteResponseSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '401': { description: bilingual('未授权', 'Unauthorized', true) },
      '404': { description: bilingual('删除申请不存在', 'Delete request not found', true) },
      '409': { description: bilingual('删除申请已关闭', 'Delete request is closed', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});
