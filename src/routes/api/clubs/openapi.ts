import { bilingual } from '$lib/schemas/common';
import { defineOpenApiRoute, jsonResponse } from '$lib/schemas/openapi';
import { clubsListQuerySchema, clubsListResponseSchema } from '$lib/schemas/organizations';

export default defineOpenApiRoute({
  get: {
    tags: ['clubs'],
    summary: bilingual('获取社团列表', 'Get clubs', true),
    description: bilingual(
      '按关键词和大学筛选社团列表，并返回大学筛选项。',
      'Get clubs filtered by search query and university, along with university filter options.'
    ),
    requestParams: {
      query: clubsListQuerySchema
    },
    responses: {
      '200': jsonResponse(
        bilingual('社团列表数据', 'Club list data', true),
        clubsListResponseSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});
