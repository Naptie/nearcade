import { bilingual } from '$lib/schemas/common';
import { defineOpenApiRoute, jsonResponse } from '$lib/schemas/openapi';
import {
  universitiesSearchQuerySchema,
  universitiesSearchResponseSchema
} from '$lib/schemas/organizations';

export default defineOpenApiRoute({
  get: {
    tags: ['universities'],
    summary: bilingual('搜索大学', 'Search universities', true),
    description: bilingual(
      '按关键词搜索大学；当查询为空时返回空列表。',
      'Search universities by keyword. Returns an empty list when the query is blank.'
    ),
    requestParams: {
      query: universitiesSearchQuerySchema
    },
    responses: {
      '200': jsonResponse(
        bilingual('大学搜索结果', 'University search results', true),
        universitiesSearchResponseSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});
