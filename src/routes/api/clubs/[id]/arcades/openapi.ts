import { bilingual } from '$lib/schemas/common';
import { defineOpenApiRoute, jsonResponse } from '$lib/schemas/openapi';
import {
  clubArcadesQuerySchema,
  clubArcadesResponseSchema,
  clubIdParamSchema
} from '$lib/schemas/organizations';

export default defineOpenApiRoute({
  get: {
    tags: ['clubs'],
    summary: bilingual('获取社团收藏店铺', 'Get club arcades', true),
    description: bilingual(
      '分页获取社团收藏的店铺列表。',
      'Get a paginated list of arcades starred by a club.'
    ),
    requestParams: {
      path: clubIdParamSchema,
      query: clubArcadesQuerySchema
    },
    responses: {
      '200': jsonResponse(
        bilingual('社团店铺列表', 'Club arcade list', true),
        clubArcadesResponseSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '404': { description: bilingual('社团不存在', 'Club not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});
