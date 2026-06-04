import { bilingual } from '$lib/schemas/common';
import { defineOpenApiRoute, jsonResponse } from '$lib/schemas/openapi';
import {
  universityDetailResponseSchema,
  universityIdParamSchema
} from '$lib/schemas/organizations';

export default defineOpenApiRoute({
  get: {
    tags: ['universities'],
    summary: bilingual('获取大学详情', 'Get university details', true),
    description: bilingual('按 ID 或 slug 获取大学详情。', 'Get university details by ID or slug.'),
    requestParams: {
      path: universityIdParamSchema
    },
    responses: {
      '200': jsonResponse(
        bilingual('大学详情', 'University details', true),
        universityDetailResponseSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '404': { description: bilingual('大学不存在', 'University not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});
