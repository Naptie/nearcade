import { bilingual } from '$lib/schemas/common';
import { defineOpenApiRoute, jsonResponse } from '$lib/schemas/openapi';
import {
  universityClubListResponseSchema,
  universityClubsQuerySchema,
  universityIdParamSchema
} from '$lib/schemas/organizations';

export default defineOpenApiRoute({
  get: {
    tags: ['universities'],
    summary: bilingual('获取大学社团', 'Get university clubs', true),
    description: bilingual(
      '分页获取属于指定大学的社团列表。',
      'Get a paginated list of clubs belonging to a university.'
    ),
    requestParams: {
      path: universityIdParamSchema,
      query: universityClubsQuerySchema
    },
    responses: {
      '200': jsonResponse(
        bilingual('大学社团列表', 'University club list', true),
        universityClubListResponseSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '404': { description: bilingual('大学不存在', 'University not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});
