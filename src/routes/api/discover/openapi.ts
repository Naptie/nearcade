import { defineOpenApiRoute, jsonResponse } from '$lib/openapi/route';
import { discoverResponseOpenApiSchema } from '$lib/openapi/components';
import { bilingual } from '$lib/schemas/common';
import { discoverQuerySchema } from '$lib/schemas/discover';

export default defineOpenApiRoute({
  get: {
    tags: ['discover'],
    summary: bilingual('获取附近店铺', 'Discover nearby shops', true),
    description: bilingual(
      '获取原点附近的店铺，可选择是否包含在勤人数和计算得出的营业时间信息。',
      'Find shops near an origin point, optionally including attendance and computed opening-time information.'
    ),
    requestParams: {
      query: discoverQuerySchema
    },
    responses: {
      '200': jsonResponse(
        bilingual('附近店铺', 'Nearby shops', true),
        discoverResponseOpenApiSchema
      ),
      '400': { description: bilingual('请求错误', 'Bad Request', true) },
      '500': { description: bilingual('服务器错误', 'Internal Server Error', true) }
    }
  }
});
