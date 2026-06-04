import { bilingual } from '$lib/schemas/common';
import { defineOpenApiRoute, jsonResponse } from '$lib/schemas/openapi';
import {
  universityChangelogQuerySchema,
  universityChangelogResponseSchema,
  universityIdParamSchema
} from '$lib/schemas/organizations';

export default defineOpenApiRoute({
  get: {
    tags: ['universities'],
    summary: bilingual('获取大学变更记录', 'Get university changelog', true),
    description: bilingual(
      '分页获取大学的变更记录。',
      'Get paginated changelog entries for a university.'
    ),
    requestParams: {
      path: universityIdParamSchema,
      query: universityChangelogQuerySchema
    },
    responses: {
      '200': jsonResponse(
        bilingual('大学变更记录', 'University changelog', true),
        universityChangelogResponseSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});
