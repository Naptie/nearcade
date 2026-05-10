import { defineOpenApiRoute, jsonResponse } from '$lib/schemas/openapi';
import { bilingual } from '$lib/schemas/common';
import {
  shopDeleteRequestsListQuerySchema,
  shopDeleteRequestsListResponseSchema
} from '$lib/schemas/shops';

export default defineOpenApiRoute({
  get: {
    tags: ['shops'],
    summary: bilingual('获取删除申请列表', 'List delete requests', true),
    description: bilingual(
      '获取店铺删除申请列表，并可按状态筛选。',
      'List shop delete requests and optionally filter them by status.'
    ),
    requestParams: {
      query: shopDeleteRequestsListQuerySchema
    },
    responses: {
      '200': jsonResponse(
        bilingual('删除申请列表', 'Delete request list', true),
        shopDeleteRequestsListResponseSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});
