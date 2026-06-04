import { defineOpenApiRoute, jsonResponse } from '$lib/schemas/openapi';
import { bilingual } from '$lib/schemas/common';
import {
  shopHistoryQuerySchema,
  shopHistoryResponseSchema,
  shopIdParamSchema
} from '$lib/schemas/shops';

export default defineOpenApiRoute({
  get: {
    tags: ['shops'],
    summary: bilingual('获取在勤历史', 'Get attendance history', true),
    description: bilingual(
      '分页获取店铺的历史在勤上报记录。',
      'Get paginated historical attendance reports for a shop.'
    ),
    requestParams: {
      path: shopIdParamSchema,
      query: shopHistoryQuerySchema
    },
    responses: {
      '200': jsonResponse(
        bilingual('在勤历史', 'Attendance history', true),
        shopHistoryResponseSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '404': { description: bilingual('店铺不存在', 'Shop not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});
