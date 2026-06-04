import { bilingual } from '$lib/schemas/common';
import { defineOpenApiRoute, jsonResponse } from '$lib/schemas/openapi';
import { clubDetailResponseSchema, clubIdParamSchema } from '$lib/schemas/organizations';

export default defineOpenApiRoute({
  get: {
    tags: ['clubs'],
    summary: bilingual('获取社团详情', 'Get club details', true),
    description: bilingual(
      '获取社团详情、成员摘要、收藏店铺以及当前用户权限。',
      'Get club details, member summaries, starred arcades, and the current user permissions.'
    ),
    requestParams: {
      path: clubIdParamSchema
    },
    responses: {
      '200': jsonResponse(bilingual('社团详情', 'Club details', true), clubDetailResponseSchema),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '404': { description: bilingual('社团不存在', 'Club not found', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});
